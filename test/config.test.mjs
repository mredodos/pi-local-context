import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateConfig, readConfig, isTarget } from '../lib/config.mjs';
import { boundSummaryPayload, createCompactionHandler } from '../lib/compaction.mjs';
import { createToolController, reduceToolResult } from '../lib/context.mjs';
import { model, config, eventFixture } from './fixtures.mjs';

test('defaults opt in no model and disable compaction without writing configuration', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-context-config-'));
  try {
    const defaults = readConfig(dir);
    assert.equal(isTarget(model, defaults), false);
    assert.equal(defaults.compaction.enabled, false);
    assert.deepEqual(fs.readdirSync(dir), []);
    assert.equal(reduceToolResult(eventFixture(), { model }, defaults), undefined);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('config accepts exact targets and independent budgets without retaining caller references', () => {
  const input = { targets: [{ provider: model.provider, id: model.id }], compaction: { enabled: true, maxTokens: 512, deadlineMs: 1000, maxProtectedChars: 1000 } };
  const result = validateConfig(input);
  input.targets[0].id = 'changed';
  assert.ok(isTarget(model, result));
  assert.equal(result.compaction.maxTokens, 512);
  assert.equal(result.compaction.disableThinking, false);
  assert.equal(isTarget({ ...model, id: 'another-model' }, result), false);
});

test('invalid or broad config fails visibly rather than silently changing scope', () => {
  for (const input of [null, [], { target: [] }, { targets: '*' }, { targets: [{}] }, { targets: [{ provider: '*', id: 'model' }] }, { logs: { enabled: 'yes' } }, { compaction: { enabled: 1 } }, { compaction: { maxTokens: 0 } }, { compaction: { maxTokens: 8193 } }, { compaction: { deadlineMs: 999 } }, { compaction: { maxProtectedChars: 50001 } }, { compaction: { unknown: true } }]) {
    assert.throws(() => validateConfig(input), JSON.stringify(input));
  }
});

test('groups reject base/helper tools, reserved names and invalid declarations', () => {
  for (const tool of ['read', 'bash', 'powershell', 'write', 'edit', 'tool_search', 'context_log', 'context_tools']) assert.throws(() => validateConfig({ toolGroups: { optional: [tool] } }));
  for (const toolGroups of [{ all: ['search'] }, { constructor: ['search'] }, { bad: [] }, { bad: ['has whitespace'] }, JSON.parse('{"__proto__":["search"]}')]) assert.throws(() => validateConfig({ toolGroups }));
});

test('file configuration rejects malformed and oversized files, and accepts the example', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-context-config-'));
  const filename = path.join(dir, 'pi-local-context.json');
  try {
    fs.writeFileSync(filename, '{broken');
    assert.throws(() => readConfig(dir), /valid JSON/);
    fs.writeFileSync(filename, ' '.repeat(65537));
    assert.throws(() => readConfig(dir), /64 KiB/);
    fs.copyFileSync(new URL('../examples/pi-local-context.json', import.meta.url), filename);
    assert.equal(readConfig(dir).targets.length, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('provider-specific thinking override requires explicit opt-in and preserves other fields', () => {
  const payload = { messages: [], max_tokens: 4096, reasoning_effort: 'medium', chat_template_kwargs: { enable_thinking: true, other: 1 } };
  const ordinary = boundSummaryPayload(payload);
  assert.equal(ordinary.chat_template_kwargs.enable_thinking, true);
  assert.equal(ordinary.reasoning_effort, 'medium');
  const qwen = boundSummaryPayload(payload, { maxTokens: 512, disableThinking: true });
  assert.equal(qwen.max_tokens, 512);
  assert.equal(qwen.chat_template_kwargs.enable_thinking, false);
  assert.equal(qwen.chat_template_kwargs.other, 1);
  assert.equal(payload.chat_template_kwargs.enable_thinking, true);
  assert.equal(boundSummaryPayload({ messages: [] }).chat_template_kwargs, undefined);
});

test('disabled features do not compact or select logs even for an exact target', async () => {
  const disabled = validateConfig({ targets: config.targets, logs: { enabled: false } });
  assert.equal(await createCompactionHandler(() => { throw new Error('must not run'); }, disabled)({}, { model }), undefined);
  assert.equal(reduceToolResult(eventFixture(), { model }, disabled), undefined);
  let active = ['read', 'bash'];
  const pi = { getActiveTools: () => active, setActiveTools: value => { active = value; } };
  createToolController(pi, disabled).refresh({ model, sessionManager: { getBranch: () => [] } }, true);
  assert.deepEqual(active, ['read', 'bash']);
});
