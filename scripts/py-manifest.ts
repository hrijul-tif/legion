/**
 * Generates public/py/manifest.json: the list of Python files the run/lang workers write
 * into the Pyodide filesystem. Invoked by vendor-assets.ts (and by the runtime tests) so it
 * never goes stale; can also be run directly: `tsx scripts/py-manifest.ts`.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pyDir = join(root, 'public', 'py');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir).sort()) {
    if (name === '__pycache__' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.py')) out.push(relative(pyDir, p).split('\\').join('/'));
  }
  return out;
}

export interface PyManifest {
  /** Content hash of all files; use as cache-busting query (`?v=<hash>`). */
  hash: string;
  files: string[];
}

export function buildPyManifest(): PyManifest {
  const files = walk(pyDir);
  const h = createHash('sha256');
  for (const f of files) {
    h.update(f);
    h.update(readFileSync(join(pyDir, f)));
  }
  const manifest: PyManifest = { hash: h.digest('hex').slice(0, 12), files };
  const next = JSON.stringify(manifest, null, 2) + '\n';
  let prev = '';
  try {
    prev = readFileSync(join(pyDir, 'manifest.json'), 'utf8');
  } catch {
    /* first run */
  }
  if (prev !== next) writeFileSync(join(pyDir, 'manifest.json'), next);
  return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const m = buildPyManifest();
  console.log(`py manifest: ${m.files.length} files, hash ${m.hash}`);
}
