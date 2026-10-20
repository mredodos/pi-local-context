import { createHash } from 'node:crypto';
import { sourcePath } from './guard-files.mjs';

export const GUARD_ENTRY = 'local-context-guard';
export const GUARD_MARKER = '[pi-local-context:BLOCKED]';
const END_MARKER = '[/pi-local-context:BLOCKED]';
const hash = text => createHash('sha256').update(text).digest('hex');

/** Recognize direct commands, keeping separators inside quoted arguments inert. */
function verificationCommand(command) {
  const parts = String(command).slice(0, 65536).match(/"(?:\\.|[^"\\])*"|'[^']*'|&&|\|\||[;&|\r\n]|[^\s"';&|]+/g) ?? [];
  const segments = [[]];
  for (const part of parts) {
    if (/^(?:&&|\|\||[;&|\r\n])$/.test(part)) segments.push([]);
    else segments.at(-1).push(/^["']/.test(part) ? part.slice(1, -1) : part);
  }
  return segments.some(([executable, ...args]) => {
    const name = executable?.split(/[/\\]/).at(-1).replace(/\.(?:cmd|exe)$/i, '').toLowerCase();
    if (['npm', 'pnpm', 'yarn', 'bun'].includes(name)) return /^(?:test|build|lint|check|typecheck)(?:[:.-]|$)/i.test(args[0] === 'run' ? args[1] ?? '' : args[0] ?? '');
    if (name === 'node') return args.includes('--test') || /(?:check|test|verify|probe|lint|build)[^/\\]*\.[cm]?js$/i.test(args[0] ?? '');
    if (/^python(?:3)?$/.test(name ?? '')) return args[0] === '-m' && args[1] === 'pytest' || /(?:check|test|verify|probe)[^/\\]*\.py$/i.test(args[0] ?? '');
    if (name === 'cargo') return ['test', 'build', 'check', 'clippy'].includes(args[0]);
    if (['go', 'dotnet'].includes(name)) return ['test', 'build'].includes(args[0]);
    if (name === 'cmake') return args[0] === '--build';
    return ['pytest', 'make', 'ninja', 'tsc'].includes(name);
  });
}

/** Keep checkpoints short and avoid repeating common credentials or header/query values. */
export function safeText(value, limit = 1200) {
  return String(value ?? '')
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,})\b/g, '[redacted]')
    .replace(/((?:authorization|cookie|set-cookie)\s*:\s*)[^\r\n]+/gi, '$1[redacted]')
    .replace(/(--(?:api[_-]?key|access[_-]?token|token|password|secret)\s+)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s;|&]+)/gi, '$1[redacted]')
    .replace(/((?:api[_-]?key|access[_-]?token|token|password|secret)["']?\s*[=:]\s*["']?)[^\s&"'`,;}]+/gi, '$1[redacted]')
    .slice(0, limit);
}

export function isVerification(event, options) {
  if (event.parentToolCallId) return false;
  return options.verificationTools.includes(event.toolName)
    || (['bash', 'powershell'].includes(event.toolName) && verificationCommand(event.input?.command ?? ''));
}

function commandKey(event) {
  const stable = value => Array.isArray(value) ? value.map(stable)
    : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
  return hash(`${event.toolName}\n${JSON.stringify(stable(event.input ?? {}))}`);
}

function diagnostic(event) {
  const original = event.details?.localContextLog?.version === 1 ? event.details.localContextLog : event;
  const structured = original.structuredContent;
  const text = structured?.truncated === false && typeof structured.output === 'string'
    ? structured.output : (original.content ?? []).filter(block => block.type === 'text').map(block => block.text).join('\n');
  const source = text.slice(0, 65536).replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '');
  const lines = source.split(/\r?\n/);
  const firstError = lines.findIndex(line => /\b(?:error|failed|failure|exception|traceback|panic|fatal|timed?\s*out|timeout|E_[A-Z_]+)\b/i.test(line));
  // Keep actual/expected values, stack locations and all other nonvolatile
  // context in the identity. A keyword-only signature conflates real progress.
  const identity = source
    .replace(/\b\d{4}-\d\d-\d\d[T ][\d:.+-]+Z?\b/g, '<time>')
    .replace(/\b\d+(?:\.\d+)?\s*(?:ms|milliseconds?|seconds?|secs?|s)\b/gi, '<duration>')
    .trim();
  return { fingerprint: hash(`${structured?.exit_code ?? ''}\n${identity}`), comparable: text.length <= 65536 && structured?.truncated !== true, text: safeText(lines.slice(Math.max(0, firstError)).join('\n')), source };
}

export const verificationSource = event => diagnostic(event).source;

export function checkpointText(checkpoint) {
  return `${GUARD_MARKER}\nBLOCKED: this phase was stopped by the local verification guard; this is an extension-generated checkpoint, not a verification pass.\nCheck: ${checkpoint.command}\nFailure: ${checkpoint.diagnostic}\nLast successful check: ${checkpoint.lastSuccess?.command ?? 'none observed in this phase'}\nReason: ${checkpoint.reason}\nWork and original tool results remain in the session. Inspect the error and fix its cause before retrying. Use /context-guard reset to start a new phase; ordinary and automatic messages do not reset this checkpoint. A change to witnessed source files also permits resumption.\n${END_MARKER}`;
}

/** Session-local conservation state: ordinary tool activity and token counters never reset failures. */
export function createLoopGuard(options) {
  const failures = new Map();
  let checkpoint;
  let lastCheck;
  let lastSuccess;
  let delivered = false;
  return {
    get checkpoint() { return checkpoint; },
    get delivered() { return delivered; },
    get status() { return { blocked: Boolean(checkpoint), checkpoint, lastCheck, lastSuccess }; },
    rearm() { delivered = false; },
    paths(event) { return Object.keys(failures.get(commandKey(event))?.witness.files ?? {}); },
    reset() { failures.clear(); checkpoint = undefined; lastCheck = undefined; lastSuccess = undefined; delivered = false; },
    restore(saved) {
      this.reset();
      if (saved?.version === 1 && saved.blocked === true && saved.checkpoint?.status === 'blocked') {
        checkpoint = saved.checkpoint; lastCheck = checkpoint; lastSuccess = checkpoint.lastSuccess;
      }
    },
    changed(filename, cwd) {
      const changed = sourcePath(filename, cwd);
      if (!changed) return;
      for (const [key, failure] of failures) {
        const paths = Object.keys(failure.witness.files);
        if (!paths.length || paths.includes(changed)) failures.delete(key);
      }
    },
    observe(event, witness = { files: {}, complete: true }) {
      if (checkpoint || !isVerification(event, options)) return undefined;
      const command = safeText(event.input?.command ?? `${event.toolName} ${JSON.stringify(event.input ?? {})}`, 400);
      const failed = event.isError === true || (Number.isFinite(event.structuredContent?.exit_code) && event.structuredContent.exit_code !== 0);
      const key = commandKey(event);
      const record = { command, toolName: event.toolName, toolCallId: event.toolCallId, time: new Date().toISOString() };
      if (!failed) {
        failures.delete(key); lastSuccess = record; lastCheck = { ...record, outcome: 'completed' }; return undefined;
      }
      const error = diagnostic(event);
      const previous = failures.get(key);
      const unchanged = previous?.witness.complete && witness.complete
        && JSON.stringify(previous.witness.files) === JSON.stringify(witness.files);
      const count = previous?.fingerprint === error.fingerprint && previous.comparable && error.comparable && unchanged ? previous.count + 1 : 1;
      const failure = { ...record, fingerprint: error.fingerprint, comparable: error.comparable, witness, count, diagnostic: error.text };
      failures.delete(key); failures.set(key, failure);
      if (failures.size > 32) failures.delete(failures.keys().next().value);
      lastCheck = { ...record, outcome: 'failed', count, diagnostic: error.text };
      if (count < 2) return undefined;
      checkpoint = { version: 1, status: 'blocked', reason: 'Two matching verification failures without observed relevant source progress.', ...record, diagnostic: error.text, attempts: count, lastSuccess, witness, toolCallIds: [previous.toolCallId, event.toolCallId] };
      return checkpoint;
    },
    handoff(text) {
      if (checkpoint || typeof text !== 'string') return undefined;
      const start = text.indexOf(GUARD_MARKER);
      const end = text.indexOf(END_MARKER, start);
      if (start < 0 || end < start) return undefined;
      checkpoint = { version: 1, status: 'blocked', reason: 'A child phase returned a verification-guard BLOCKED checkpoint.', command: 'workflow child phase', diagnostic: safeText(text.slice(start + GUARD_MARKER.length, end), 2200), lastSuccess, time: new Date().toISOString() };
      delivered = false;
      return checkpoint;
    },
    terminal(message) {
      if (!checkpoint || message.role !== 'assistant') return undefined;
      delivered = true;
      // Pi's supported same-role replacement runs before tool calls and persistence.
      // Keep actual provider identity/usage; label all replacement text as guard-generated.
      const replacement = { ...message, content: [{ type: 'text', text: checkpointText(checkpoint) }], stopReason: message.stopReason === 'error' || message.stopReason === 'aborted' ? message.stopReason : 'stop' };
      if (message.stopReason === 'error') replacement.errorMessage = `${safeText(message.errorMessage, 500)}\n${checkpointText(checkpoint)}`;
      return replacement;
    },
  };
}

/** One token is sufficient: the next assistant message is replaced by a local checkpoint. */
export function boundGuardContinuation(payload) {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.messages)) return undefined;
  const result = { ...payload };
  if (Object.hasOwn(result, 'max_completion_tokens')) { result.max_completion_tokens = 1; delete result.max_tokens; }
  else result.max_tokens = 1;
  return result;
}
