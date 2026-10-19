import { Type } from '@earendil-works/pi-ai';
import { defineTool, getAgentDir, type ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { readConfig } from '../lib/config.mjs';
import { createToolController, recoverLog, reduceToolResult } from '../lib/context.mjs';

/** Expose recoverable shell logs and explicitly configured optional tool groups. */
export default function contextEfficiency(pi: ExtensionAPI) {
  let config;
  try { config = readConfig(getAgentDir()); }
  catch (error) {
    pi.on('session_start', (_event, ctx) => ctx.ui.notify(`pi-local-context disabled: ${error.message}`, 'error'));
    return;
  }
  const controller = createToolController(pi, config);
  const groups = Object.keys(config.toolGroups);
  if (groups.length) pi.registerTool(defineTool({
    name: 'context_tools',
    label: 'Load optional tools',
    description: `Load optional tool schemas for the next call: ${groups.join(', ')}, or all. Groups stay loaded on this branch. Use tool_search for MCP discovery.`,
    parameters: Type.Object({ group: Type.Union([...groups, 'all'].map(group => Type.Literal(group))) }),
    defaultActive: false,
    reachesTools: ({ group }) => group === 'all' ? Object.values(config.toolGroups).flat() : config.toolGroups[group] ?? [],
    prepareLoadout: loadout => controller.project(loadout),
    async execute(_id, { group }, _signal, _onUpdate, ctx) {
      const names = controller.load(group, ctx);
      return { content: [{ type: 'text', text: `Declared from the next call: ${names.join(', ') || 'no registered tools in this group'}.` }], details: { names } };
    },
  }));
  if (config.logs.enabled) pi.registerTool(defineTool({
    name: 'context_log',
    label: 'Read original log',
    description: 'Read original lines omitted from a selected shell log in this session. Use the toolCallId shown in the result; optional query finds literal text. Numbered output is capped at 400 lines / 16k characters. Follow nextLine to continue.',
    parameters: Type.Object({
      toolCallId: Type.String(),
      startLine: Type.Optional(Type.Integer({ minimum: 1 })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 400 })),
      query: Type.Optional(Type.String()),
    }),
    defaultActive: false,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async execute(_id, args, _signal, _onUpdate, ctx) {
      const result = recoverLog(ctx.sessionManager.getBranch(), args);
      return { content: [{ type: 'text', text: result.text }], details: { nextLine: result.nextLine, totalLines: result.totalLines } };
    },
  }));
  pi.on('tool_result', (event, ctx) => reduceToolResult(event, ctx, config));
  pi.on('session_start', (_event, ctx) => controller.refresh(ctx, true));
  pi.on('session_tree', (_event, ctx) => controller.refresh(ctx, true));
  pi.on('model_select', (event, ctx) => controller.refresh({ ...ctx, model: event.model }));
  pi.on('before_agent_start', (_event, ctx) => { controller.refresh(ctx); });
}
