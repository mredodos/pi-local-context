import fs from 'node:fs';
import path from 'node:path';

export const CONFIG_FILE = 'pi-local-context.json';
const BASE_TOOLS = new Set(['read', 'bash', 'powershell', 'edit', 'write', 'tool_search', 'context_log', 'context_tools']);

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value;
}

function keys(value, allowed, label) {
  object(value, label);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`Unknown ${label} option: ${key}`);
}

function boolean(value, fallback, label) {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw new Error(`${label} must be a boolean.`);
  return value;
}

function integer(value, fallback, min, max, label) {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${label} must be ${min}..${max}.`);
  return value;
}

/** Reject mistakes rather than silently broadening the models or tools affected. */
export function validateConfig(input = {}) {
  keys(input, ['targets', 'compaction', 'logs', 'toolGroups'], 'configuration');
  const targets = input.targets ?? [];
  if (!Array.isArray(targets) || targets.length > 100) throw new Error('targets must be an array of at most 100 exact provider/id pairs.');
  for (const target of targets) {
    keys(target, ['provider', 'id'], 'target');
    for (const key of ['provider', 'id']) {
      if (typeof target[key] !== 'string' || !target[key].trim() || target[key].includes('*')) throw new Error(`target.${key} must be an exact non-empty string, without wildcards.`);
    }
  }
  const compaction = input.compaction ?? {};
  keys(compaction, ['enabled', 'maxTokens', 'deadlineMs', 'maxProtectedChars', 'disableThinking'], 'compaction');
  const logs = input.logs ?? {};
  keys(logs, ['enabled'], 'logs');
  const groups = input.toolGroups ?? {};
  object(groups, 'toolGroups');
  if (Object.keys(groups).length > 20) throw new Error('At most 20 tool groups are supported.');
  const toolGroups = Object.create(null);
  for (const [name, tools] of Object.entries(groups)) {
    if (!/^[a-z][a-z0-9_-]{0,39}$/.test(name) || ['all', '__proto__', 'constructor', 'prototype'].includes(name)) throw new Error('Invalid or reserved tool group name.');
    if (!Array.isArray(tools) || !tools.length || tools.length > 100 || tools.some(tool => typeof tool !== 'string' || !/^[\w.-]+$/.test(tool) || BASE_TOOLS.has(tool))) throw new Error(`Group ${name} must contain 1..100 optional tool names, excluding base/helper tools.`);
    toolGroups[name] = [...new Set(tools)];
  }
  return {
    targets: targets.map(target => ({ ...target })),
    compaction: {
      enabled: boolean(compaction.enabled, false, 'compaction.enabled'),
      maxTokens: integer(compaction.maxTokens, 2048, 256, 8192, 'compaction.maxTokens'),
      deadlineMs: integer(compaction.deadlineMs, 120000, 1000, 300000, 'compaction.deadlineMs'),
      maxProtectedChars: integer(compaction.maxProtectedChars, 20000, 1000, 50000, 'compaction.maxProtectedChars'),
      disableThinking: boolean(compaction.disableThinking, false, 'compaction.disableThinking'),
    },
    logs: { enabled: boolean(logs.enabled, true, 'logs.enabled') },
    toolGroups,
  };
}

/** Read only the global agent config; a missing file deliberately opts in no models. */
export function readConfig(agentDir) {
  const filename = path.join(agentDir, CONFIG_FILE);
  let source;
  try { source = fs.readFileSync(filename, 'utf8'); }
  catch (error) {
    if (error.code === 'ENOENT') return validateConfig();
    throw new Error(`Cannot read ${CONFIG_FILE}: ${error.code ?? 'read failure'}`);
  }
  if (source.length > 65536) throw new Error(`${CONFIG_FILE} exceeds 64 KiB.`);
  let parsed;
  try { parsed = JSON.parse(source); }
  catch { throw new Error(`${CONFIG_FILE} is not valid JSON.`); }
  return validateConfig(parsed);
}

export function isTarget(model, config) {
  return config.targets.some(target => model?.provider === target.provider && model?.id === target.id);
}
