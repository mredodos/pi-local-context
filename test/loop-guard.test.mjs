import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createLoopGuard, isVerification, safeText, checkpointText, boundGuardContinuation, GUARD_MARKER } from '../lib/loop-guard.mjs';
import { fileWitness, sourcePath, sourcePaths } from '../lib/guard-files.mjs';
import { validateConfig } from '../lib/config.mjs';

const options = { verificationTools: ['synthetic_check'] };
const failure = (id = '1', text = 'src/demo.ts:12: error E_DEMO: mismatch') => ({ toolName: 'bash', toolCallId: id, input: { command: 'npm run build' }, isError: true, content: [{ type: 'text', text }], structuredContent: { output: text, truncated: false, exit_code: 1 } });
const witness = value => ({ complete: true, files: { 'src/demo.ts': value } });

test('two identical failures latch a bounded checkpoint without deleting the original event', () => {
  const guard = createLoopGuard(options);
  const event = failure(); const before = structuredClone(event);
  assert.equal(guard.observe(event, witness('a')), undefined);
  assert.equal(guard.status.lastCheck.count, 1);
  const checkpoint = guard.observe(failure('2'), witness('a'));
  assert.equal(checkpoint.status, 'blocked');
  assert.equal(checkpoint.attempts, 2);
  assert.deepEqual(checkpoint.toolCallIds, ['1', '2']);
  assert.deepEqual(event, before);
  assert.match(checkpointText(checkpoint), /extension-generated checkpoint/);
  assert.match(checkpointText(checkpoint), /not a verification pass/);
});

test('different errors and commands do not count as the same failure', () => {
  const guard = createLoopGuard(options);
  guard.observe(failure(), witness('a'));
  assert.equal(guard.observe(failure('2', 'src/demo.ts:12: error E_OTHER: missing'), witness('a')), undefined);
  assert.equal(guard.status.lastCheck.count, 1);
  const other = { ...failure('3'), input: { command: 'npm test' } };
  assert.equal(guard.observe(other, witness('a')), undefined);
});

test('successful checks reset only their own failure; ordinary tool reads do not prove progress', () => {
  const guard = createLoopGuard(options);
  guard.observe(failure(), witness('a'));
  guard.observe({ ...failure('read'), toolName: 'read', isError: false }, witness('a'));
  assert.ok(guard.observe(failure('2'), witness('a')));
  guard.reset();
  guard.observe(failure(), witness('a'));
  guard.observe({ ...failure('ok'), isError: false, structuredContent: { exit_code: 0 } }, witness('a'));
  assert.equal(guard.observe(failure('2'), witness('a')), undefined);
  assert.equal(guard.status.lastSuccess.toolCallId, 'ok');
});

test('observed relevant source changes reset retries while unrelated or generated files do not', () => {
  const guard = createLoopGuard(options);
  guard.observe(failure(), witness('a'));
  guard.changed('src/demo.ts', process.cwd());
  assert.equal(guard.observe(failure('2'), witness('b')), undefined);
  guard.changed('src/unrelated.ts', process.cwd());
  guard.changed('reports/run.json', process.cwd());
  assert.ok(guard.observe(failure('3'), witness('b')));
});

test('external source bytes changed between checks count as observed progress', () => {
  const guard = createLoopGuard(options);
  guard.observe(failure(), witness('before'));
  assert.equal(guard.observe(failure('2'), witness('after')), undefined);
});

test('unknown/incomplete file witnesses cannot prove an unchanged failure', () => {
  const guard = createLoopGuard(options);
  guard.observe(failure(), { files: {}, complete: false });
  assert.equal(guard.observe(failure('2'), { files: {}, complete: false }), undefined);
});

test('volatile durations/timestamps normalize without conflating different error codes', () => {
  const guard = createLoopGuard(options);
  guard.observe(failure('1', '2026-10-20T10:00:00Z error E_DEMO: failed after 12.4 seconds'), witness('a'));
  assert.ok(guard.observe(failure('2', '2026-10-20T11:00:00Z error E_DEMO: failed after 18.7 seconds'), witness('a')));
  const other = createLoopGuard(options);
  other.observe(failure('1', 'error HTTP 403'), witness('a'));
  assert.equal(other.observe(failure('2', 'error HTTP 404'), witness('a')), undefined);
});

test('failure identity retains actual/expected detail and refuses incomplete or oversized captures', () => {
  const guard = createLoopGuard(options);
  guard.observe(failure('1', 'error: |-\n  actual: 1\n  expected: 2'), witness('a'));
  assert.equal(guard.observe(failure('2', 'error: |-\n  actual: 3\n  expected: 2'), witness('a')), undefined);
  for (const event of [failure('large', 'x'.repeat(65537)), { ...failure(), structuredContent: { output: 'error E_DEMO', truncated: true, exit_code: 1 } }]) {
    guard.reset(); guard.observe(event, witness('a'));
    assert.equal(guard.observe(event, witness('a')), undefined);
  }
  guard.reset();
  const original = failure('original');
  const reduced = { ...failure('reduced', 'Selected log: omitted rows'), structuredContent: { output: 'selected', truncated: true, exit_code: 1 }, details: { localContextLog: { version: 1, content: original.content, structuredContent: original.structuredContent } } };
  guard.observe(original, witness('a'));
  assert.ok(guard.observe(reduced, witness('a')));
});

test('verification recognition is explicit; nested calls and unrelated shell commands pass through', () => {
  assert.ok(isVerification(failure(), options));
  assert.ok(isVerification({ ...failure(), input: { command: 'node scripts/verify-demo.mjs' } }, options));
  assert.ok(isVerification({ ...failure(), toolName: 'synthetic_check' }, options));
  assert.equal(isVerification({ ...failure(), parentToolCallId: 'outer' }, options), false);
  assert.equal(isVerification({ ...failure(), input: { command: 'cat app.js' } }, options), false);
  assert.equal(isVerification({ ...failure(), toolName: 'read' }, options), false);
  assert.equal(isVerification({ ...failure(), input: { command: 'node ordinary-script.mjs --message "; npm test"' } }, options), false);
  assert.ok(isVerification({ ...failure(), toolName: 'powershell', input: { command: 'npm.cmd run build' } }, options));
  assert.ok(isVerification({ ...failure(), input: { command: 'node "scripts/verify demo.mjs"' } }, options));
});

test('terminal replacement preserves usage and identity and prevents a tool-request continuation', () => {
  const guard = createLoopGuard(options);
  guard.observe(failure(), witness('a')); guard.observe(failure('2'), witness('a'));
  const message = { role: 'assistant', provider: 'synthetic', model: 'test', api: 'openai-completions', content: [{ type: 'toolCall', id: 'third', name: 'bash', arguments: {} }], stopReason: 'toolUse', usage: { input: 100, output: 1 } };
  const replacement = guard.terminal(message);
  assert.equal(replacement.stopReason, 'stop');
  assert.deepEqual(replacement.usage, message.usage);
  assert.equal(replacement.provider, 'synthetic');
  assert.match(replacement.content[0].text, /BLOCKED/);
  assert.ok(message.content.some(block => block.type === 'toolCall'));
  assert.match(guard.terminal(message).content[0].text, /BLOCKED/);
});

test('authentic provider errors retain their failure rather than becoming a verification success', () => {
  const guard = createLoopGuard(options);
  guard.observe(failure(), witness('a')); guard.observe(failure('2'), witness('a'));
  const replacement = guard.terminal({ role: 'assistant', content: [], stopReason: 'error', errorMessage: 'Synthetic transport failed' });
  assert.equal(replacement.stopReason, 'error');
  assert.match(replacement.errorMessage, /Synthetic transport failed/);
  assert.match(replacement.errorMessage, /BLOCKED/);
});

test('branch checkpoints restore and reset; automatic child handoffs retain a blocked gate', () => {
  const first = createLoopGuard(options);
  first.observe(failure(), witness('a')); first.observe(failure('2'), witness('a'));
  const second = createLoopGuard(options);
  second.restore({ version: 1, blocked: true, checkpoint: first.checkpoint });
  assert.ok(second.checkpoint);
  second.reset(); assert.equal(second.checkpoint, undefined);
  assert.ok(second.handoff(`Synthetic workflow result\n${checkpointText(first.checkpoint)}`));
  assert.equal(second.checkpoint.command, 'workflow child phase');
});

test('checkpoints redact common credentials and the final output cap applies only to a valid payload', () => {
  const text = safeText('Authorization: Bearer synthetic-value\nurl?token=synthetic-value&ok=1\npassword="synthetic-value"\nnpm test -- --token synthetic-value --password "synthetic-value"');
  assert.ok(!text.includes('synthetic-value'));
  const original = { messages: [], max_tokens: 32768, tools: [{ name: 'test' }] };
  const bounded = boundGuardContinuation(original);
  assert.equal(bounded.max_tokens, 1);
  assert.equal(original.max_tokens, 32768);
  assert.deepEqual(bounded.tools, original.tools);
  assert.equal(boundGuardContinuation({ max_tokens: 12 }), undefined);
  assert.equal(boundGuardContinuation({ messages: [], max_completion_tokens: 50 }).max_completion_tokens, 1);
});

test('guard config requires exact opt-in and reserves its status helper', () => {
  assert.equal(validateConfig().loopGuard.enabled, false);
  assert.deepEqual(validateConfig({ loopGuard: { enabled: true, verificationTools: ['demo'] } }).loopGuard.verificationTools, ['demo']);
  for (const config of [{ loopGuard: { enabled: 'yes' } }, { loopGuard: { verificationTools: ['bad name'] } }, { toolGroups: { optional: ['context_guard'] } }]) assert.throws(() => validateConfig(config));
});

test('file witnesses detect bytes, ignore identical rewrites/generated files, and stay confined', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-guard-files-'));
  try {
    await fs.writeFile(path.join(dir, 'demo.ts'), 'const value = 1;');
    const first = await fileWitness(['demo.ts', '../outside.ts'], dir);
    assert.equal(Object.keys(first.files).length, 1);
    await fs.writeFile(path.join(dir, 'demo.ts'), 'const value = 1;');
    assert.deepEqual(await fileWitness(['demo.ts'], dir), first);
    await fs.writeFile(path.join(dir, 'demo.ts'), 'const value = 2;');
    assert.notDeepEqual(await fileWitness(['demo.ts'], dir), first);
    assert.equal(sourcePath('reports/generated.json', dir), undefined);
    assert.equal(sourcePath('build-report.json', dir), undefined);
    assert.equal(sourcePath('../outside.ts', dir), undefined);
    assert.deepEqual(sourcePaths('error src/demo.ts:12; node scripts/verify.mjs', dir), ['src/demo.ts', 'scripts/verify.mjs']);
    assert.deepEqual(sourcePaths('src/demo file.ts:12: error E_DEMO\nsrc/header.h:3: error E_DEMO\nnode "scripts/verify demo.mjs"', dir), ['scripts/verify demo.mjs', 'src/demo file.ts', 'src/header.h']);
    assert.deepEqual(sourcePaths('Error: E_DEMO\n    at src/demo.ts:12:3\nE   src/demo.py:12: error E_DEMO\nsrc/demo.c:12: error E_DEMO', dir), ['src/demo.ts', 'src/demo.py', 'src/demo.c']);
    await fs.writeFile(path.join(dir, 'huge.ts'), 'x'.repeat(262145));
    assert.equal((await fileWitness(['huge.ts'], dir)).complete, false);
    assert.equal((await fileWitness(['missing.ts'], dir)).files['missing.ts'], 'missing');
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
