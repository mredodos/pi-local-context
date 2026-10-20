import { Type } from '@earendil-works/pi-ai';
import { defineTool, getAgentDir, type ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { readConfig, isTarget } from '../lib/config.mjs';
import { fileWitness, sourcePath, sourcePaths } from '../lib/guard-files.mjs';
import { createLoopGuard, isVerification, verificationSource, checkpointText, boundGuardContinuation, GUARD_ENTRY } from '../lib/loop-guard.mjs';

/** Child-safe execution guard; no provider registration, orchestration or background timer. */
export default function loopGuard(pi: ExtensionAPI) {
  let config;
  try { config = readConfig(getAgentDir()); }
  catch (error) {
    pi.on('session_start', (_event, ctx) => ctx.ui.notify(`pi-local-context guard disabled: ${error.message}`, 'error'));
    return;
  }
  const guard = createLoopGuard(config.loopGuard);
  const pendingEdits = new Map();
  const enabled = ctx => config.loopGuard.enabled && isTarget(ctx.model, config);
  const saved = () => ({ version: 1, blocked: Boolean(guard.checkpoint), checkpoint: guard.checkpoint });
  const persist = () => pi.appendEntry(GUARD_ENTRY, saved());
  const status = () => ({
    blocked: Boolean(guard.checkpoint),
    lastCheck: guard.status.lastCheck,
    lastSuccessfulCheck: guard.status.lastSuccess,
    checkpoint: guard.checkpoint ? checkpointText(guard.checkpoint) : undefined,
  });
  const display = ctx => ctx.ui.setStatus('local-context-guard', !enabled(ctx) ? undefined
    : guard.checkpoint ? 'verification BLOCKED'
    : guard.status.lastCheck ? `verification ${guard.status.lastCheck.outcome}${guard.status.lastCheck.count ? ` ${guard.status.lastCheck.count}/2` : ''}` : undefined);
  const trip = (checkpoint, ctx) => {
    persist();
    ctx.ui.notify('Verification guard: repeated failure; phase stopped and checkpoint preserved.', 'warning');
    display(ctx);
  };
  const restore = ctx => {
    const entry = [...ctx.sessionManager.getBranch()].reverse().find(item => item.type === 'custom' && item.customType === GUARD_ENTRY);
    guard.restore(entry?.data);
    pendingEdits.clear();
    const active = pi.getActiveTools().filter(name => name !== 'context_guard');
    pi.setActiveTools(enabled(ctx) ? [...active, 'context_guard'] : active);
    display(ctx);
  };
  pi.registerTool(defineTool({
    name: 'context_guard', label: 'Verification progress',
    description: 'Read the local verification guard status: last completed check, current failure and BLOCKED checkpoint. This tool cannot reset the guard.',
    parameters: Type.Object({}), defaultActive: false,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async execute() { return { content: [{ type: 'text', text: JSON.stringify(status()) }], details: {} }; },
  }));
  pi.registerCommand('context-guard', {
    description: 'Show verification progress; use reset to begin a new phase after diagnosing the failure.',
    async handler(args, ctx) {
      if (args.trim() === 'reset') { guard.reset(); pendingEdits.clear(); persist(); display(ctx); }
      ctx.ui.notify(JSON.stringify(status()), guard.checkpoint ? 'warning' : 'info');
    },
  });
  pi.on('session_start', (_event, ctx) => restore(ctx));
  pi.on('session_tree', (_event, ctx) => restore(ctx));
  pi.on('model_select', (event, ctx) => restore({ ...ctx, model: event.model }));
  pi.on('session_shutdown', () => { pendingEdits.clear(); });
  // SDK schema repairs also use input.source='interactive'. Only the explicit
  // command or changed witnessed source may reopen a blocked phase.
  pi.on('before_agent_start', async (_event, ctx) => {
    if (!enabled(ctx) || !guard.checkpoint) return;
    guard.rearm();
    if (!guard.checkpoint.witness) return;
    const previous = guard.checkpoint.witness;
    const current = await fileWitness(Object.keys(previous.files), ctx.cwd);
    if (previous.complete && current.complete && JSON.stringify(previous.files) !== JSON.stringify(current.files)) {
      guard.reset(); persist(); display(ctx);
    }
  });
  pi.on('tool_call', async (event, ctx) => {
    if (!enabled(ctx)) return;
    if (guard.checkpoint && event.toolName !== 'context_guard') {
      return { block: true, terminate: true, reason: checkpointText(guard.checkpoint) };
    }
    if (['edit', 'write'].includes(event.toolName) && !event.parentToolCallId) {
      const filename = sourcePath(event.input?.path, ctx.cwd);
      if (!filename) return;
      if (pendingEdits.size >= 64) pendingEdits.delete(pendingEdits.keys().next().value);
      pendingEdits.set(event.toolCallId, { filename, before: await fileWitness([filename], ctx.cwd) });
    }
  });
  pi.on('tool_result', async (event, ctx) => {
    if (!enabled(ctx)) return;
    const edit = pendingEdits.get(event.toolCallId);
    pendingEdits.delete(event.toolCallId);
    if (edit && !event.isError) {
      const after = await fileWitness([edit.filename], ctx.cwd);
      if (edit.before.complete && after.complete && JSON.stringify(edit.before.files) !== JSON.stringify(after.files)) guard.changed(edit.filename, ctx.cwd);
    }
    if (event.toolName === 'workflow') {
      const text = event.content.filter(block => block.type === 'text').map(block => block.text).join('\n');
      const checkpoint = guard.handoff(text);
      if (checkpoint) {
        trip(checkpoint, ctx);
        return { content: [...event.content, { type: 'text', text: checkpointText(checkpoint) }], ...(event.structuredContent !== undefined ? { structuredContent: event.structuredContent } : {}), isError: true, details: { ...event.details, localContextGuard: { status: 'blocked' } } };
      }
    }
    if (!isVerification(event, config.loopGuard)) return;
    const paths = [...guard.paths(event), ...sourcePaths(event.input?.command ?? '', ctx.cwd), ...sourcePaths(verificationSource(event), ctx.cwd)];
    const checkpoint = guard.observe(event, await fileWitness(paths, ctx.cwd));
    display(ctx);
    if (checkpoint) {
      trip(checkpoint, ctx);
      return { content: [...event.content, { type: 'text', text: checkpointText(checkpoint) }], ...(event.structuredContent !== undefined ? { structuredContent: event.structuredContent } : {}), details: { ...event.details, localContextGuard: { status: 'blocked' } }, isError: event.isError };
    }
  });
  pi.on('before_provider_request', (event, ctx) => {
    if (enabled(ctx) && guard.checkpoint && ctx.model?.api === 'openai-completions') return boundGuardContinuation(event.payload);
  });
  pi.on('message_end', (event, ctx) => {
    if (!enabled(ctx)) return;
    if (event.message.role === 'custom' && /workflow/i.test(event.message.customType ?? '')) {
      const content = event.message.content;
      const text = typeof content === 'string' ? content : content.filter(block => block.type === 'text').map(block => block.text).join('\n');
      const checkpoint = guard.handoff(text);
      if (checkpoint) trip(checkpoint, ctx);
    }
    const message = guard.terminal(event.message);
    if (message) return { message };
  });
  pi.on('turn_end', (_event, ctx) => {
    if (enabled(ctx) && guard.checkpoint && guard.delivered) return { continue: false };
  });
}
