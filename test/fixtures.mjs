import { validateConfig } from '../lib/config.mjs';
/** Synthetic fixtures only; no user conversation data. */
export const model = { provider: 'synthetic-local', id: 'synthetic-model', api: 'openai-completions', maxTokens: 32768, contextWindow: 98304 };
export function logFixture() {
  const rows = Array.from({length: 600}, (_, i) => `[build] module module_${i}.ts: compilation passed; checked 12 declarations and 4 imports; no diagnostics.`);
  rows.splice(300, 0, 'src/cache/key.ts:73: error E_CACHE_STALE: cache key version mismatch.', '  at makeCacheKey (src/cache/key.ts:73)', 'warning: cancellation regression remains untested');
  return rows.join('\n');
}
export function eventFixture() {
  const text = logFixture();
  return { type: 'tool_result', toolName: 'bash', toolCallId: 'synthetic-log-1', input: {command: 'npm run build'}, content: [{type: 'text', text}], structuredContent: {output: text, truncated: false, exit_code: 1, wall_time_seconds: 2}, isError: true, details: {existing: 'preserved'} };
}


export const config = validateConfig({
  targets: [{ provider: model.provider, id: model.id }],
  compaction: { enabled: true, disableThinking: true },
  toolGroups: {
    web: ['web_search', 'source_check', 'fetch_content', 'get_search_content'],
    workflow: ['workflow', 'workflow_control'],
  },
});
