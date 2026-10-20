import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Type } from '@earendil-works/pi-ai';
import { AssistantMessageEventStream } from '@earendil-works/pi-ai/utils/event-stream';
import { ModelRuntime, ModelRegistry, SettingsManager, SessionManager, DefaultResourceLoader, createAgentSession } from '@earendil-works/pi-coding-agent';

/** Fully synthetic provider and tools; no transport or machine credentials are read. */
export async function withGuardEnvironment(plan, fn, { enabled = true, otherTarget = false, entryName = 'loop-guard' } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-guard-sdk-'));
  const cwd = path.join(dir, 'workspace');
  const agentDir = path.join(dir, 'agent');
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  try {
    await fs.mkdir(path.join(cwd, 'src'), { recursive: true });
    await fs.mkdir(path.join(agentDir, 'extensions'), { recursive: true });
    await fs.mkdir(path.join(agentDir, 'lib'), { recursive: true });
    await fs.writeFile(path.join(cwd, 'src/demo.ts'), 'export const value = 1;');
    await fs.copyFile(new URL('../extensions/loop-guard.ts', import.meta.url), path.join(agentDir, 'extensions', `${entryName}.ts`));
    for (const name of ['config.mjs', 'guard-files.mjs', 'loop-guard.mjs']) await fs.copyFile(new URL(`../lib/${name}`, import.meta.url), path.join(agentDir, 'lib', name));
    await fs.writeFile(path.join(agentDir, 'pi-local-context.json'), JSON.stringify({ targets: [{ provider: otherTarget ? 'other' : 'guard-test', id: 'guard-model' }], logs: { enabled: false }, loopGuard: { enabled } }));
    const settings = { defaultProvider: 'guard-test', defaultModel: 'guard-model', compaction: { enabled: false }, retry: { enabled: false }, cacheWarming: 'off' };
    await fs.writeFile(path.join(agentDir, 'settings.json'), JSON.stringify(settings));
    const environment = { cwd, agentDir, checks: 0, writes: 0, requests: [], outcomes: [], notices: [] };
    const modelRuntime = await ModelRuntime.create({ modelsPath: null, modelsStorePath: null, authPath: path.join(agentDir, 'unused-auth.json'), allowModelNetwork: false, refreshOnCreate: false });
    modelRuntime.registerProvider('guard-test', {
      api: 'openai-completions', baseUrl: 'http://127.0.0.1:1/v1', apiKey: 'synthetic-only',
      models: [{ id: 'guard-model', name: 'Synthetic guard test', input: ['text'], reasoning: false, contextWindow: 98304, maxTokens: 32768, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
      streamSimple(model, context, options = {}) {
        const stream = new AssistantMessageEventStream();
        void (async () => {
          const payload = await options.onPayload?.({ messages: [], max_tokens: 32768 });
          const index = environment.requests.length;
          environment.requests.push({ payload, messages: structuredClone(context.messages) });
          const action = typeof plan === 'function' ? await plan(index, environment) : plan[index];
          if (!action) throw new Error(`Unexpected synthetic provider request ${index}`);
          const content = action.tools ? action.tools.map((tool, i) => ({ type: 'toolCall', id: `call-${index}-${i}`, ...tool })) : [{ type: 'text', text: action.text ?? 'Synthetic final answer.' }];
          const message = { role: 'assistant', api: model.api, provider: model.provider, model: model.id, content, stopReason: action.tools ? 'toolUse' : 'stop', usage: { input: 100, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 101, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, timestamp: Date.now() };
          stream.push({ type: 'done', reason: message.stopReason, message }); stream.end();
        })().catch(error => {
          const message = { role: 'assistant', api: model.api, provider: model.provider, model: model.id, content: [], stopReason: 'error', errorMessage: error.message, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, timestamp: Date.now() };
          stream.push({ type: 'error', reason: 'error', error: message }); stream.end();
        });
        return stream;
      },
    });
    const model = modelRuntime.getModel('guard-test', 'guard-model');
    assert.ok(model);
    const tools = [
      { name: 'bash', label: 'Synthetic verification', description: 'Synthetic build check, no shell process.', parameters: Type.Object({ command: Type.String() }), async execute() {
        const isError = environment.outcomes[environment.checks] ?? true; environment.checks++;
        const text = isError ? environment.diagnostic ?? 'src/demo.ts:12: error E_DEMO: synthetic mismatch' : 'Synthetic verification completed.';
        return { content: [{ type: 'text', text }], isError, structuredContent: { output: text, truncated: false, exit_code: isError ? 1 : 0 }, details: {} };
      } },
      { name: 'write', label: 'Synthetic source write', description: 'Write a fixture inside the temporary workspace.', parameters: Type.Object({ path: Type.String(), content: Type.String() }), async execute(_id, args) {
        environment.writes++;
        const target = path.resolve(cwd, args.path);
        assert.ok(target.startsWith(cwd + path.sep));
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, args.content);
        return { content: [{ type: 'text', text: 'Synthetic fixture saved.' }], details: {} };
      } },
    ];
    const settingsManager = SettingsManager.inMemory(settings);
    const resourceOptions = { cwd, agentDir, settingsManager, noExtensions: true, additionalExtensionPaths: [path.join(agentDir, 'extensions', `${entryName}.ts`)], noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true, systemPrompt: 'Synthetic fixture test only.' };
    const resourceLoader = new DefaultResourceLoader(resourceOptions);
    await resourceLoader.reload();
    assert.deepEqual(resourceLoader.getExtensions().errors, []);
    Object.assign(environment, { tools, modelRuntime, model, registry: new ModelRegistry(modelRuntime), settingsManager, resourceLoader });
    environment.createSession = async () => {
      const sessionResources = new DefaultResourceLoader(resourceOptions);
      await sessionResources.reload();
      const { session } = await createAgentSession({ cwd, agentDir, modelRuntime, model, resourceLoader: sessionResources, settingsManager, sessionManager: SessionManager.inMemory(cwd), customTools: tools });
      await session.bindExtensions({});
      return session;
    };
    await fn(environment);
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    await fs.rm(dir, { recursive: true, force: true });
  }
}

export const check = () => ({ tools: [{ name: 'bash', arguments: { command: 'npm run build' } }] });
export const write = content => ({ tools: [{ name: 'write', arguments: { path: 'src/demo.ts', content } }] });
export const latestAssistant = session => [...session.messages].reverse().find(message => message.role === 'assistant');
