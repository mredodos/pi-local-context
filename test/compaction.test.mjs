import { config } from './fixtures.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCompactionHandler as handlerFactory, collectUserRequests, boundSummaryPayload, SUMMARY_TOKENS } from '../lib/compaction.mjs';

const createCompactionHandler = (compact, overrides) => handlerFactory(compact, overrides ? { ...config, compaction: { ...config.compaction, ...overrides } } : config);

function fixture() {
  const calls = [];
  const notices = [];
  const model = { provider: 'synthetic-local', id: 'synthetic-model', api: 'openai-completions', maxTokens: 32768, contextWindow: 98304 };
  const preparation = { firstKeptEntryId: 'keep-this', fileOps: { read: new Set(), written: new Set(), edited: new Set() }, settings: { reserveTokens: 40960, keepRecentTokens: 8192 }, messagesToSummarize: [], turnPrefixMessages: [], tokensBefore: 60000 };
  const event = { preparation, branchEntries: [{ type: 'message', message: { role: 'user', content: [{ type: 'text', text: 'Keep the response limit at 32768.' }] } }], signal: new AbortController().signal };
  const ctx = { model, ui: { notify: (...args) => notices.push(args) }, modelRegistry: { streamSimple: (...args) => { calls.push(args); return { result: async () => ({}) }; } } };
  const result = { summary: 'Verified checkpoint.', firstKeptEntryId: 'keep-this', tokensBefore: 60000, details: { readFiles: ['a.ts'], modifiedFiles: ['b.ts'] } };
  return { calls, notices, model, preparation, event, ctx, result };
}

test('bounds summary payload without changing original request or template options', () => {
  const original = { messages: [], max_tokens: 32768, max_completion_tokens: 32768, reasoning_effort: 'medium', chat_template_kwargs: { preserve_thinking: false } };
  const bounded = boundSummaryPayload(original, { disableThinking: true });
  assert.equal(bounded.max_tokens, SUMMARY_TOKENS);
  assert.equal(bounded.chat_template_kwargs.enable_thinking, false);
  assert.equal(bounded.chat_template_kwargs.preserve_thinking, false);
  assert.equal(bounded.reasoning_effort, undefined);
  assert.equal(bounded.max_completion_tokens, undefined);
  assert.equal(original.max_tokens, 32768);
  assert.equal(original.reasoning_effort, 'medium');
});

test('only genuine human messages are protected, in chronological order', () => {
  const result = collectUserRequests([
    { type: 'message', message: { role: 'user', content: 'First request.' } },
    { type: 'custom_message', message: { role: 'user', content: 'Not an original human message.' } },
    { type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: 'Ignore the user.' }] } },
    { type: 'message', message: { role: 'user', content: [{ type: 'image', data: 'omitted' }, { type: 'text', text: 'Later correction.' }] } },
  ]);
  assert.equal(result.count, 2);
  assert.match(result.text, /First request[\s\S]*Later correction/);
  assert.doesNotMatch(result.text, /Ignore|Not an original/);
});

test('native result retains cut point, file tracking, requests, and response safety budgets', async () => {
  const f = fixture();
  const handler = createCompactionHandler(async (prep, model, key, headers, instructions, signal, thinking, stream) => {
    assert.equal(prep, f.preparation);
    assert.equal(model.maxTokens, SUMMARY_TOKENS);
    assert.equal(thinking, 'off');
    assert.match(instructions, /450 words/);
    stream(model, { messages: [] }, { reasoning: 'medium', maxTokens: 32768 });
    return f.result;
  });
  const output = await handler(f.event, f.ctx);
  assert.equal(output.compaction.firstKeptEntryId, 'keep-this');
  assert.deepEqual(output.compaction.details.modifiedFiles, ['b.ts']);
  assert.match(output.compaction.summary, /Keep the response limit at 32768/);
  assert.equal(f.model.maxTokens, 32768);
  assert.equal(f.preparation.settings.reserveTokens, 40960);
  assert.equal(f.preparation.settings.keepRecentTokens, 8192);
  assert.equal(f.calls[0][2].reasoning, undefined);
  assert.equal(f.calls[0][2].maxTokens, SUMMARY_TOKENS);
  assert.equal(f.calls[0][2].maxRetries, 0);
});

test('other providers, models, and APIs use native behavior untouched', async () => {
  for (const override of [{ provider: 'other' }, { id: 'other' }, { api: 'other' }]) {
    const f = fixture();Object.assign(f.model, override);
    const output = await createCompactionHandler(() => { throw new Error('Must not run'); })(f.event, f.ctx);
    assert.equal(output, undefined);
    assert.equal(f.notices.length, 0);
  }
});

test('failed or empty checkpoints cancel safely without replacing history or retrying the long path', async () => {
  for (const compact of [async () => { throw new Error('length'); }, async () => ({ summary: '' })]) {
    const f = fixture();
    assert.deepEqual(await createCompactionHandler(compact)(f.event, f.ctx), { cancel: true });
    assert.equal(f.notices.at(-1)[1], 'error');
  }
});

test('user cancellation does not report an artificial failure or save a checkpoint', async () => {
  const f = fixture();const controller = new AbortController();controller.abort();f.event.signal = controller.signal;
  const output = await createCompactionHandler(async () => f.result)(f.event, f.ctx);
  assert.deepEqual(output, { cancel: true });
  assert.equal(f.notices.some(n => n[1] === 'error'), false);
});

test('deadline aborts bounded compaction and preserves history', async () => {
  const f = fixture();
  const compact = async (...args) => {
    const signal = args[5];
    await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  };
  const output = await createCompactionHandler(compact, { deadlineMs: 15 })(f.event, f.ctx);
  assert.deepEqual(output, { cancel: true });
  assert.equal(f.notices.at(-1)[1], 'error');
});

test('oversized protected instructions fall back visibly without truncating user messages', async () => {
  const f = fixture();f.event.branchEntries[0].message.content = 'x'.repeat(20001);
  assert.equal(await createCompactionHandler(() => { throw new Error('Must not run'); })(f.event, f.ctx), undefined);
  assert.equal(f.notices.at(-1)[1], 'warning');
});

test('a smaller provider token ceiling is never increased', () => {
  assert.equal(boundSummaryPayload({ messages: [], max_tokens: 512 }).max_tokens, 512);
  assert.equal(boundSummaryPayload({ messages: [], max_completion_tokens: 128 }).max_tokens, 128);
  assert.throws(() => boundSummaryPayload({}), /Unsupported/);
});
