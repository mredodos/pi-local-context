import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DefaultResourceLoader, SettingsManager } from '@earendil-works/pi-coding-agent';
import { config } from './fixtures.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

async function withPackage(input, check) {
  const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-context-package-'));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  if (input !== undefined) fs.writeFileSync(path.join(agentDir, 'pi-local-context.json'), input);
  try {
    const loader = new DefaultResourceLoader({
      cwd: root, agentDir, settingsManager: SettingsManager.inMemory(),
      noExtensions: true, noSkills: true, noPromptTemplates: true,
      noThemes: true, noContextFiles: true, additionalExtensionPaths: [root],
    });
    await loader.reload();
    assert.deepEqual(fs.readdirSync(agentDir), input === undefined ? [] : ['pi-local-context.json']);
    const result = loader.getExtensions();
    assert.deepEqual(result.errors, []);
    assert.equal(result.extensions.length, 3);
    await check(result.extensions);
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    fs.rmSync(agentDir, { recursive: true, force: true });
  }
}

test('the actual Pi package manifest discovers all entries with no configuration', async () => {
  await withPackage(undefined, async extensions => {
    const compaction = extensions.find(extension => extension.handlers.has('session_before_compact'));
    assert.ok(compaction);
    assert.equal(await compaction.handlers.get('session_before_compact')[0]({}, { model: { provider: 'anything', id: 'anything' } }), undefined);
    const context = extensions.find(extension => extension.tools.has('context_log'));
    assert.ok(context);
    assert.equal(context.tools.has('context_tools'), false);
  });
});

test('the package loads configured helpers and rejects invalid config with session-start errors', async () => {
  await withPackage(JSON.stringify(config), async extensions => {
    assert.ok(extensions.some(extension => extension.tools.has('context_tools')));
    assert.ok(extensions.some(extension => extension.tools.has('context_log')));
  });
  await withPackage('{invalid', async extensions => {
    const notices = [];
    for (const extension of extensions) {
      assert.equal(extension.tools.size, 0);
      assert.equal(extension.handlers.has('session_before_compact'), false);
      await extension.handlers.get('session_start')[0]({}, { ui: { notify: (...args) => notices.push(args) } });
    }
    assert.equal(notices.length, 3);
    assert.ok(notices.every(([message, level]) => message.includes('not valid JSON') && level === 'error'));
  });
});
