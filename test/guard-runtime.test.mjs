import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Type } from '@earendil-works/pi-ai';
import { WorkflowAgent } from '@quintinshaw/pi-dynamic-workflows';
import { GUARD_MARKER, GUARD_ENTRY } from '../lib/loop-guard.mjs';
import { withGuardEnvironment, check, write, latestAssistant } from './guard-fixtures.mjs';

test('native Pi stops two repeated failures even when the model attempts another write', async () => {
  await withGuardEnvironment([check(), check(), write('must not execute')], async env => {
    const session = await env.createSession();
    try {
      await session.prompt('Synthetic repeated build verification.');
      assert.equal(env.checks, 2);
      assert.equal(env.writes, 0);
      assert.equal(env.requests.length, 3);
      assert.equal(env.requests[0].payload?.max_tokens, 32768);
      assert.equal(env.requests[2].payload?.max_tokens, 1);
      const final = latestAssistant(session);
      assert.equal(final.stopReason, 'stop');
      assert.ok(final.content[0].text.includes(GUARD_MARKER));
      assert.equal(final.usage.output, 1);
      const branch = session.sessionManager.getBranch();
      assert.equal(branch.filter(entry => entry.type === 'message' && entry.message.role === 'toolResult').length, 2);
      assert.ok(branch.some(entry => entry.type === 'custom' && entry.customType === GUARD_ENTRY && entry.data.blocked));
      assert.equal((await fs.readFile(path.join(env.cwd, 'src/demo.ts'), 'utf8')), 'export const value = 1;');
    } finally { session.dispose(); }
  });
});

test('real source changes let the phase continue; identical rewrites do not reset failures', async () => {
  for (const changed of [true, false]) {
    await withGuardEnvironment([check(), write(changed ? 'export const value = 2;' : 'export const value = 1;'), check(), { text: 'Synthetic final.' }], async env => {
      const session = await env.createSession();
      try {
        await session.prompt('Synthetic source update then recheck.');
        assert.equal(env.checks, 2);
        assert.equal(env.writes, 1);
        assert.equal(latestAssistant(session).content[0].text.includes(GUARD_MARKER), !changed);
      } finally { session.dispose(); }
    });
  }
});

test('disabled guard or a different model leaves ordinary requests unchanged', async () => {
  for (const options of [{ enabled: false }, { otherTarget: true }]) {
    await withGuardEnvironment([check(), check(), check(), { text: 'Finished normally.' }], async env => {
      const session = await env.createSession();
      try {
        await session.prompt('Synthetic opt-in test.');
        assert.equal(env.checks, 3);
        assert.equal(latestAssistant(session).content[0].text, 'Finished normally.');
        assert.ok(env.requests.every(request => request.payload?.max_tokens === 32768));
      } finally { session.dispose(); }
    }, options);
  }
});

test('native tree restore and automatic input retain the checkpoint; the reset command opens a fresh phase', async () => {
  await withGuardEnvironment([check(), check(), write('never'), { text: 'Fresh phase.' }], async env => {
    const session = await env.createSession();
    try {
      await session.prompt('Synthetic repeat.');
      await session.extensionRunner.emit({ type: 'session_tree' });
      const blocked = await session.extensionRunner.emitToolCall({ type: 'tool_call', toolName: 'bash', toolCallId: 'blocked', input: { command: 'npm run build' } });
      assert.equal(blocked.block, true);
      await session.extensionRunner.emitInput('New explicit user request', undefined, 'interactive');
      const stillBlocked = await session.extensionRunner.emitToolCall({ type: 'tool_call', toolName: 'bash', toolCallId: 'still-blocked', input: { command: 'npm run build' } });
      assert.equal(stillBlocked.block, true);
      await session.extensionRunner.getCommand('context-guard').handler('reset', session.extensionRunner.createCommandContext());
      const allowed = await session.extensionRunner.emitToolCall({ type: 'tool_call', toolName: 'bash', toolCallId: 'allowed', input: { command: 'npm run build' } });
      assert.ok(!allowed?.block);
      await session.prompt('Fresh phase after explicit reset.');
      assert.equal(latestAssistant(session).content[0].text, 'Fresh phase.');
    } finally { session.dispose(); }
  });
});

test('actual WorkflowAgent loads the allowlisted child guard and returns a BLOCKED checkpoint', async () => {
  await withGuardEnvironment([check(), check(), write('must not execute')], async env => {
    const agent = new WorkflowAgent({ cwd: env.cwd, tools: env.tools, modelRegistry: env.registry, providerMiddlewareExtensions: ['loop-guard'], session: { modelRuntime: env.modelRuntime, model: env.model, settingsManager: env.settingsManager } });
    const result = await agent.run('Synthetic guard integration, no application task.', { model: 'guard-test/guard-model' });
    assert.equal(typeof result, 'string');
    assert.ok(result.includes(GUARD_MARKER));
    assert.match(result, /not a verification pass/);
    assert.equal(env.checks, 2);
    assert.equal(env.writes, 0);
    assert.equal(env.requests.length, 3);
  });
});

test('structured workflows surface a blocked phase as schema failure rather than fabricating a pass', async () => {
  await withGuardEnvironment(index => index < 2 ? check() : { tools: [{ name: 'structured_output', arguments: { status: 'passed' } }] }, async env => {
    const history = [];
    const agent = new WorkflowAgent({ cwd: env.cwd, tools: env.tools, modelRegistry: env.registry, providerMiddlewareExtensions: ['loop-guard'], session: { modelRuntime: env.modelRuntime, model: env.model, settingsManager: env.settingsManager } });
    await assert.rejects(agent.run('Synthetic schema test.', { model: 'guard-test/guard-model', schema: Type.Object({ status: Type.Literal('passed') }), onHistory: entries => history.push(...entries) }), error => error.code === 'SCHEMA_NONCOMPLIANCE' && error.recoverable === false);
    assert.equal(env.checks, 2);
    assert.equal(env.writes, 0);
    assert.ok(history.some(entry => entry.text?.includes(GUARD_MARKER)));
    assert.ok(env.requests.slice(2).every(request => request.payload?.max_tokens === 1));
  });
});

test('independent native sessions do not share the blocked state', async () => {
  await withGuardEnvironment([check(), check(), write('never'), { text: 'Independent session answer.' }], async env => {
    const first = await env.createSession();
    const second = await env.createSession();
    try {
      await first.prompt('Synthetic failing phase.');
      await second.prompt('Independent synthetic phase.');
      assert.ok(latestAssistant(first).content[0].text.includes(GUARD_MARKER));
      assert.equal(latestAssistant(second).content[0].text, 'Independent session answer.');
    } finally { first.dispose(); second.dispose(); }
  });
});

test('a coordinator receiving a blocked background result cannot automatically launch more tools', async () => {
  await withGuardEnvironment([write('must not execute')], async env => {
    const session = await env.createSession();
    try {
      await session.extensionRunner.emitMessageEnd({ type: 'message_end', message: { role: 'custom', customType: 'workflow-result', content: '[pi-local-context:BLOCKED]\nSynthetic child failure checkpoint.\n[/pi-local-context:BLOCKED]', display: true, timestamp: 0 } });
      const call = await session.extensionRunner.emitToolCall({ type: 'tool_call', toolName: 'workflow', toolCallId: 'next', input: { script: 'synthetic' } });
      assert.equal(call.block, true);
      await session.prompt('Automatic synthetic workflow completion handoff.');
      assert.equal(env.writes, 0);
      assert.ok(latestAssistant(session).content[0].text.includes(GUARD_MARKER));
    } finally { session.dispose(); }
  });
});

test('source paths containing spaces and root generated reports do not create false progress decisions', async () => {
  for (const filename of ['src/demo file.ts', 'build-report.json']) {
    await withGuardEnvironment([check(), { tools: [{ name: 'write', arguments: { path: filename, content: 'export const value = 2;' } }] }, check(), { text: 'Synthetic final.' }], async env => {
      env.diagnostic = `${filename}:12: error E_DEMO: synthetic mismatch`;
      await fs.writeFile(path.join(env.cwd, filename), 'export const value = 1;');
      const session = await env.createSession();
      try {
        await session.prompt('Synthetic source and generated file comparison.');
        assert.equal(env.checks, 2);
        assert.equal(latestAssistant(session).content[0].text.includes(GUARD_MARKER), filename === 'build-report.json');
      } finally { session.dispose(); }
    });
  }
});

test('a batch already accepted by Pi may finish but subsequent model tool calls are stopped', async () => {
  await withGuardEnvironment([{ tools: Array.from({ length: 4 }, () => check().tools[0]) }, write('must not execute')], async env => {
    const session = await env.createSession();
    try {
      await session.prompt('Synthetic parallel verification batch.');
      assert.equal(env.checks, 4);
      assert.equal(env.writes, 0);
      assert.ok(latestAssistant(session).content[0].text.includes(GUARD_MARKER));
    } finally { session.dispose(); }
  });
});

test('workflow handoff annotates the result without dropping original content or structured output', async () => {
  await withGuardEnvironment([], async env => {
    const session = await env.createSession();
    try {
      const original = { type: 'tool_result', toolName: 'workflow', toolCallId: 'synthetic-workflow', input: {}, isError: false, content: [{ type: 'text', text: 'Earlier phase evidence.\n[pi-local-context:BLOCKED]\nSynthetic child checkpoint.\n[/pi-local-context:BLOCKED]' }], structuredContent: false, details: { original: true } };
      const annotated = await session.extensionRunner.emitToolResult(original);
      assert.deepEqual(annotated.content[0], original.content[0]);
      assert.deepEqual(annotated.structuredContent, original.structuredContent);
      assert.equal(annotated.details.original, true);
      assert.equal(annotated.isError, true);
    } finally { session.dispose(); }
  });
});

test('a stack-only source path prevents unrelated writes from masquerading as progress', async () => {
  await withGuardEnvironment([check(), { tools: [{ name: 'write', arguments: { path: 'src/unrelated.ts', content: 'export const unrelated = 2;' } }] }, check(), { text: 'Never count this write as progress.' }], async env => {
    env.diagnostic = 'Error: E_DEMO synthetic mismatch\n    at src/demo.ts:12:3';
    const session = await env.createSession();
    try {
      await session.prompt('Synthetic stack diagnostic.');
      assert.ok(latestAssistant(session).content[0].text.includes(GUARD_MARKER));
    } finally { session.dispose(); }
  });
});

test('native provider retries cannot clear a blocked checkpoint or claim a verification pass', async () => {
  await withGuardEnvironment(index => {
    if (index < 2) return check();
    if (index === 2) throw new Error('503 Service Unavailable: synthetic temporary provider error');
    return { text: 'Synthetic verification passed.' };
  }, async env => {
    env.settingsManager.getRetrySettings = () => ({ enabled: true, maxRetries: 1, baseDelayMs: 1, maxAgentDelayMs: 1 });
    const session = await env.createSession();
    try {
      const retryFinished = new Promise(resolve => session.subscribe(event => { if (event.type === 'auto_retry_end') resolve(); }));
      await session.prompt('Synthetic repeated failures followed by provider retry.');
      await retryFinished;
      assert.equal(env.checks, 2);
      assert.ok(env.requests.slice(2).every(request => request.payload?.max_tokens === 1));
      assert.ok(latestAssistant(session).content[0].text.includes(GUARD_MARKER));
      assert.ok(!latestAssistant(session).content[0].text.includes('Synthetic verification passed.'));
    } finally { session.dispose(); }
  });
});

test('an external change to witnessed source permits a new phase after the blocked checkpoint', async () => {
  await withGuardEnvironment([check(), check(), write('never'), { text: 'Resumed after witnessed source changed.' }], async env => {
    const session = await env.createSession();
    try {
      await session.prompt('Synthetic failing phase.');
      await fs.writeFile(path.join(env.cwd, 'src/demo.ts'), 'export const value = 2;');
      await session.prompt('Synthetic resume after an external edit.');
      assert.equal(latestAssistant(session).content[0].text, 'Resumed after witnessed source changed.');
    } finally { session.dispose(); }
  });
});
