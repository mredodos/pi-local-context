import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const SOURCE = /\.(?:[cm]?[jt]sx?|py|rs|go|php|java|cs|c|cpp|h|hpp|html|css|scss|json|ya?ml|toml|lock|sh|ps1)$/i;
const GENERATED = /(?:^|[/\\])(?:node_modules|dist|build|target|coverage|reports?|logs?|\.git|\.tmp|__pycache__)(?:[/\\]|$)/i;
const GENERATED_FILE = /(?:^|[/\\])(?:[^/\\]*[._-])?(?:report|results?|logs?|coverage)(?:[._-][^/\\]*)?\.(?:json|ya?ml|html|xml)$/i;

/** Limit progress witnesses to source/configuration inside the current workspace. */
export function sourcePath(filename, cwd) {
  if (typeof filename !== 'string' || !SOURCE.test(filename) || GENERATED.test(filename) || GENERATED_FILE.test(filename)) return undefined;
  const absolute = path.resolve(cwd, filename);
  const relative = path.relative(path.resolve(cwd), absolute);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return undefined;
  return relative.replaceAll(path.sep, '/');
}

/** Observe actual bytes without persisting or returning source contents. */
export async function fileWitness(filenames, cwd) {
  const files = {};
  let complete = true;
  let total = 0;
  const candidates = [...new Set(filenames.map(name => sourcePath(name, cwd)).filter(Boolean))].sort();
  if (candidates.length > 32) complete = false;
  const root = await fs.realpath(cwd);
  for (const name of candidates.slice(0, 32)) {
    const filename = path.resolve(cwd, name);
    let handle;
    try {
      const real = await fs.realpath(filename);
      const relative = path.relative(root, real);
      if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) { complete = false; continue; }
      handle = await fs.open(real, 'r');
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > 262144 || total + stat.size > 1048576) { complete = false; continue; }
      const buffer = Buffer.alloc(Math.min(262145, 1048577 - total));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      const after = await handle.stat();
      if (bytesRead !== stat.size || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || bytesRead > 262144 || bytesRead + total > 1048576) { complete = false; continue; }
      total += bytesRead;
      files[name] = createHash('sha256').update(buffer.subarray(0, bytesRead)).digest('hex');
    } catch (error) {
      if (error.code === 'ENOENT') files[name] = 'missing';
      else complete = false;
    } finally { await handle?.close(); }
  }
  return { files, complete };
}

/** Recognize direct script arguments and source paths named by diagnostics. */
export function sourcePaths(text, cwd) {
  if (typeof text !== 'string') return [];
  const input = text.slice(0, 65536);
  const extension = '(?:[cm]?[jt]sx?|py|rs|go|php|java|cs|c|cpp|h|hpp|html|css|scss|json|ya?ml|toml|lock|sh|ps1)';
  // Quoted command paths and line-leading diagnostics can contain spaces.
  // Mask those spans so a suffix such as 'file.ts' is not also invented.
  const spans = [];
  const matches = [];
  const quoted = new RegExp(`["']([^"'\\r\\n]+\\.${extension})["']`, 'g');
  const stack = new RegExp(`\\(([^()\\r\\n]+\\.${extension})(?=:\\d)`, 'g');
  const diagnostic = new RegExp(`^\\s*(?:(?:(?:error|fatal)\\s*:?|at|E)\\s+)?((?:[A-Za-z]:)?[^"'()\\r\\n:]+\\.${extension})(?=:\\d|\\(\\d)`, 'gmi');
  for (const pattern of [quoted, stack, diagnostic]) for (const match of input.matchAll(pattern)) {
    const name = match[1].trim();
    if (sourcePath(name, cwd)) { matches.push(name); spans.push([match.index, match.index + match[0].length]); }
  }
  const remaining = input.split('');
  for (const [start, end] of spans) remaining.fill(' ', start, end);
  matches.push(...remaining.join('').match(new RegExp(`(?:[A-Za-z]:)?[\\w./\\\\-]+\\.${extension}\\b`, 'g')) ?? []);
  return [...new Set(matches.map(name => sourcePath(name, cwd)).filter(Boolean))].slice(0, 32);
}
