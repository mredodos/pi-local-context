import { isTarget, validateConfig } from './config.mjs';

/** Conservative input reduction for explicitly selected models. */
export const LOG_KEY = 'localContextLog';
export const TOOLS_ENTRY = 'local-context-tool-groups';
const OWN_TOOLS = ['context_log', 'context_tools'];
const DIAGNOSTIC = /\b(?:error|warn(?:ing)?s?|fail(?:ed|ure|ures)?|exception|traceback|panic|fatal|skip(?:ped)?|cancel(?:led|ed)?|abort(?:ed)?|deprecated|vulnerab\w*|security|not\s+(?:ok|passed))\b|\bE_[A-Z_]+\b|[⚠✗]/i;
const BUILD_COMMAND = /(?:^|[;&|\n])\s*(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test|build|lint|check|typecheck)\b|node\s+--test\b|(?:python(?:3)?\s+-m\s+)?pytest\b|cargo\s+(?:test|build|check|clippy)\b|go\s+(?:test|build)\b|cmake\s+--build\b|(?:make|ninja|tsc)\b|dotnet\s+(?:test|build)\b)/i;

function routine(line) {
  if (DIAGNOSTIC.test(line)) return false;
  return /^\s*(?:PASS|[✓✔])\s+\S.{0,240}$/.test(line)
    || /^\[build\] module [\w./\\@-]+: compilation passed(?:; checked \d+ declarations and \d+ imports; no diagnostics\.)?$/.test(line)
    || /^\s*\[\s*(?:\d+\/\d+|\d+%)\]\s+(?:Building|Compiling|Linking|Generating|Built)(?: target)?\s+\S.{0,240}$/.test(line);
}

/** Remove only recognized routine rows; retain every other row and its neighbors. */
export function selectLog(text) {
  if (typeof text !== 'string' || text.length < 8000 || text.length > 1048576) return undefined;
  const lines = text.split(/\r?\n/);
  if (lines.length < 80 || lines.some(line => line.length > 12000)) return undefined;
  const keep = lines.map((line, i) => i < 4 || i >= lines.length - 6 || !routine(line));
  for (let i = 0; i < lines.length; i++) {
    if (!routine(lines[i])) {
      if (i > 0) keep[i - 1] = true;
      if (i + 1 < lines.length) keep[i + 1] = true;
    }
  }
  const output = [];
  let omitted = 0;
  for (let i = 0; i < lines.length;) {
    if (keep[i]) { output.push(lines[i++]); continue; }
    const start = i;
    while (i < lines.length && !keep[i]) i++;
    if (i - start < 4) output.push(...lines.slice(start, i));
    else {
      omitted += i - start;
      output.push(`[${i - start} routine success/progress rows omitted, original lines ${start + 1}-${i}]`);
    }
  }
  const selected = output.join('\n');
  if (omitted < 40 || selected.length > text.length * 0.75) return undefined;
  return { text: selected, originalLines: lines.length, omitted, sourceChars: text.length };
}

function originalText(content, structured) {
  if (structured?.truncated === false && typeof structured.output === 'string') return structured.output;
  return content.map(block => block.text).join('\n');
}

/** Persist originals only in Pi's existing non-model-facing result details. */
export function reduceToolResult(event, ctx, config = validateConfig()) {
  if (!isTarget(ctx.model, config) || !config.logs.enabled || event.parentToolCallId || !['bash', 'powershell'].includes(event.toolName)) return undefined;
  if (!BUILD_COMMAND.test(event.input?.command ?? '') || !event.toolCallId || event.details?.[LOG_KEY]) return undefined;
  if (!Array.isArray(event.content) || event.content.length !== 1 || event.content[0].type !== 'text') return undefined;
  // Pi can turn timeout exceptions into text-only tails without truncation metadata.
  // Require positive proof of a complete capture before omitting any rows.
  const completeStructured = event.structuredContent?.truncated === false && typeof event.structuredContent.output === 'string';
  if (!completeStructured) return undefined;
  const source = originalText(event.content, event.structuredContent);
  const selected = selectLog(source);
  if (!selected) return undefined;
  const original = { version: 1, content: event.content, structuredContent: event.structuredContent, sourceChars: selected.sourceChars, omittedLines: selected.omitted };
  const exitCode = event.structuredContent?.exit_code;
  const nativePath = event.details?.fullOutputPath;
  const note = `[Selected log: ${selected.omitted}/${selected.originalLines} routine rows omitted; all unrecognized rows retained. Result: ${event.isError ? 'ERROR' : 'completed'}${Number.isFinite(exitCode) ? `; exit_code=${exitCode}` : ''}. Original: context_log with toolCallId=${JSON.stringify(event.toolCallId)}.${nativePath ? ` Native full-output file: ${nativePath}.` : ''}]`;
  const text = `${note}\n${selected.text}`;
  return {
    content: [{ type: 'text', text }],
    details: { ...event.details, [LOG_KEY]: original },
    ...(event.structuredContent ? { structuredContent: { ...event.structuredContent, output: text, truncated: true, ...(nativePath ? { full_output_path: nativePath } : {}) } } : {}),
    isError: event.isError,
  };
}

/** Retrieve a bounded, line-numbered original from this session's branch, including compacted entries. */
export function recoverLog(entries, { toolCallId, startLine = 1, limit = 120, query }) {
  if (!Number.isInteger(startLine) || startLine < 1 || !Number.isInteger(limit) || limit < 1 || limit > 400) throw new Error('startLine must be positive; limit must be 1..400.');
  const entry = [...entries].reverse().find(e => e.type === 'message' && e.message?.role === 'toolResult' && e.message.toolCallId === toolCallId && e.message.details?.[LOG_KEY]);
  if (!entry) throw new Error('No preserved log for this toolCallId on the current session branch.');
  const saved = entry.message.details[LOG_KEY];
  const lines = originalText(saved.content, saved.structuredContent).split(/\r?\n/);
  const needle = query?.toLowerCase();
  const selected = [];
  let chars = 0;
  let nextLine = lines.length + 1;
  for (let i = startLine - 1; i < lines.length; i++) {
    if (needle && !lines[i].toLowerCase().includes(needle)) continue;
    const line = `${i + 1}: ${lines[i]}`;
    if (selected.length >= limit || chars + line.length + 1 > 16000) { nextLine = i + 1; break; }
    selected.push(line); chars += line.length + 1;
  }
  return { text: `Original log ${toolCallId}; ${lines.length} total lines; nextLine=${nextLine > lines.length ? 'end' : nextLine}.\n${selected.join('\n') || '(no matching lines)'}`, nextLine, totalLines: lines.length };
}

/** Stable native declaration projection: loaded groups remain loaded on this branch. */
export function createToolController(pi, config = validateConfig()) {
  const TOOL_GROUPS = config.toolGroups;
  const OPTIONAL = new Set(Object.values(TOOL_GROUPS).flat());
  const ownTools = [ ...(config.logs.enabled ? ['context_log'] : []), ...(OPTIONAL.size ? ['context_tools'] : []) ];
  let enabled = false;
  let loaded = new Set();
  return {
    project(loadout) {
      if (!enabled) return undefined;
      return { hiddenDeclarations: loadout.declared.map(t => t.name).filter(name => OPTIONAL.has(name) && ![...loaded].some(group => TOOL_GROUPS[group].includes(name))) };
    },
    refresh(ctx, restore = false) {
      const nextEnabled = isTarget(ctx.model, config);
      if (restore) {
        const entries = ctx.sessionManager.getBranch();
        const saved = [...entries].reverse().find(e => e.type === 'custom' && e.customType === TOOLS_ENTRY);
        const groups = Array.isArray(saved?.data?.groups) ? saved.data.groups : [];
        loaded = new Set(groups.filter(group => Object.hasOwn(TOOL_GROUPS, group)));
      }
      const changed = enabled !== nextEnabled;
      enabled = nextEnabled;
      if (changed || restore) {
        const active = pi.getActiveTools().filter(name => !OWN_TOOLS.includes(name));
        pi.setActiveTools(enabled ? [...active, ...ownTools] : active);
      }
    },
    load(group, ctx) {
      if (!isTarget(ctx.model, config)) throw new Error('This loader is scoped to configured target models.');
      const groups = group === 'all' ? Object.keys(TOOL_GROUPS) : [group];
      if (groups.some(g => !Object.hasOwn(TOOL_GROUPS, g))) throw new Error('Unknown tool group.');
      const available = new Set(pi.getAllTools().filter(t => t.exposure !== 'hidden').map(t => t.name));
      const wanted = groups.flatMap(g => TOOL_GROUPS[g]).filter(name => available.has(name));
      groups.forEach(g => loaded.add(g));
      pi.appendEntry(TOOLS_ENTRY, { groups: [...loaded] });
      pi.setActiveTools([...new Set([...pi.getActiveTools(), ...wanted, ...ownTools])]);
      return wanted.filter(name => pi.getActiveTools().includes(name));
    },
  };
}
