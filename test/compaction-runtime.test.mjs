import fs from 'node:fs';
import os from 'node:os';
import { config } from './fixtures.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createCompactionHandler as handlerFactory, SUMMARY_TOKENS } from '../lib/compaction.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent'))));
const { compact } = await import(pathToFileURL(path.join(root, 'dist/core/compaction/compaction.js')));
const { discoverAndLoadExtensions } = await import(pathToFileURL(path.join(root, 'dist/core/extensions/loader.js')));
const here = path.dirname(fileURLToPath(import.meta.url));
const createCompactionHandler = compact => handlerFactory(compact, config);
const usage = { input: 100, output: 30, cacheRead: 0, cacheWrite: 0, totalTokens: 130, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };

function fixture(stopReason = 'stop', split = false) {
  const calls = [];
  const messages = [{ role: 'user', content: [{ type: 'text', text: 'Keep the existing response limit.' }], timestamp: 0 }];
  const model = { provider: 'synthetic-local', id: 'synthetic-model', api: 'openai-completions', maxTokens: 32768, contextWindow: 98304, reasoning: true, input: ['text'], cost: usage.cost };
  const event = {
    preparation: { firstKeptEntryId: 'retained', messagesToSummarize: messages, turnPrefixMessages: split ? messages : [], isSplitTurn: split, tokensBefore: 60000, previousSummary: 'Previous verified work.', fileOps: { read: new Set(['read.ts']), written: new Set(['written.ts']), edited: new Set() }, settings: { enabled: true, reserveTokens: 40960, keepRecentTokens: 8192 } },
    branchEntries: [{ type: 'message', message: messages[0] }],
    signal: new AbortController().signal,
  };
  const ctx = { model, ui: { notify() {} }, modelRegistry: { streamSimple(summaryModel, context, options) {
    const payload = options.onPayload({ messages: [], reasoning_effort: 'medium', max_tokens: 32768 });
    calls.push({ summaryModel, options, payload });
    return { result: async () => ({ role: 'assistant', content: [{ type: 'text', text: 'Objective: continue safely. Verified: existing limits preserved. Next: test.' }], api: model.api, provider: model.provider, model: model.id, stopReason, usage, timestamp: 0 }) };
  } } };
  return { calls, event, ctx };
}

test('native Pi loader registers the extension without requests or configuration changes', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-context-loader-'));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  try {
  const result = await discoverAndLoadExtensions([path.join(here, '../extensions/fast-compaction.ts')], here, path.join(here, 'empty-test-agent'));
  assert.deepEqual(result.errors, []);
  assert.equal(result.extensions.length, 1);
  assert.equal(result.extensions[0].handlers.get('session_before_compact').length, 1);
  } finally { if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous; fs.rmSync(dir, { recursive: true, force: true }); }
});

for (const split of [false, true]) {
  test(`native Pi compaction preserves boundaries and files (split=${split})`, async () => {
    const f = fixture('stop', split);
    const result = await createCompactionHandler(compact)(f.event, f.ctx);
    assert.ok(result.compaction);
    assert.equal(result.compaction.firstKeptEntryId, 'retained');
    assert.deepEqual(result.compaction.details.readFiles, ['read.ts']);
    assert.deepEqual(result.compaction.details.modifiedFiles, ['written.ts']);
    assert.match(result.compaction.summary, /Keep the existing response limit/);
    assert.equal(f.calls.length, split ? 2 : 1);
    for (const call of f.calls) {
      assert.equal(call.options.maxTokens, SUMMARY_TOKENS);
      assert.equal(call.payload.max_tokens, SUMMARY_TOKENS);
      assert.equal(call.payload.chat_template_kwargs.enable_thinking, false);
      assert.equal(call.payload.reasoning_effort, undefined);
    }
    assert.equal(f.ctx.model.maxTokens, 32768);
  });
}

test('native token-limit failure cannot save a partial checkpoint', async () => {
  const f = fixture('length');
  assert.deepEqual(await createCompactionHandler(compact)(f.event, f.ctx), { cancel: true });
});
