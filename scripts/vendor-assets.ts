/**
 * Copies / downloads everything the browser needs to run Python and the editor without a CDN
 * (the app is cross-origin isolated, so all assets must be same-origin under /vendor).
 *
 *   public/vendor/pyodide/   pyodide runtime + jedi/parso wheels (downloaded, sha256-verified)
 *   public/vendor/monaco/vs  monaco-editor/min/vs
 *   public/vendor/ruff/      ruff wasm (via scripts/vendor-ruff.ts, for the lang worker)
 *
 * Idempotent; run by `postinstall` and `npm run vendor`. Also regenerates public/py/manifest.json.
 */
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPyManifest } from './py-manifest';
import { vendorRuff } from './vendor-ruff';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const nm = join(root, 'node_modules');
const out = join(root, 'public', 'vendor');
const pyodideOut = join(out, 'pyodide');

/** Pyodide packages we need as wheels, besides what ships in node_modules/pyodide. */
const WHEELS = ['jedi', 'parso'];
const PYODIDE_FILES = [
  'pyodide.mjs',
  'pyodide.asm.mjs',
  'pyodide.asm.wasm',
  'python_stdlib.zip',
  'pyodide-lock.json',
];

interface LockPackage {
  file_name: string;
  sha256: string;
  depends: string[];
  name: string;
}
interface Lock {
  packages: Record<string, LockPackage>;
}

function sha256(buf: Uint8Array): string {
  return createHash('sha256').update(buf).digest('hex');
}

function copyIfChanged(src: string, dest: string): boolean {
  if (existsSync(dest)) {
    const a = statSync(src);
    const b = statSync(dest);
    if (a.size === b.size && b.mtimeMs >= a.mtimeMs) return false;
  }
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(src, dest);
  return true;
}

function resolveWheels(lock: Lock, names: string[]): LockPackage[] {
  const seen = new Map<string, LockPackage>();
  const visit = (raw: string) => {
    const key = raw.toLowerCase().replace(/_/g, '-');
    if (seen.has(key)) return;
    const pkg = lock.packages[key];
    if (!pkg) throw new Error(`pyodide-lock.json has no package "${raw}"`);
    seen.set(key, pkg);
    pkg.depends.forEach(visit);
  };
  names.forEach(visit);
  return [...seen.values()];
}

async function downloadWheel(version: string, pkg: LockPackage): Promise<'cached' | 'downloaded'> {
  const dest = join(pyodideOut, pkg.file_name);
  if (existsSync(dest) && sha256(readFileSync(dest)) === pkg.sha256) return 'cached';
  const url = `https://cdn.jsdelivr.net/pyodide/v${version}/full/${pkg.file_name}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  const got = sha256(buf);
  if (got !== pkg.sha256) throw new Error(`sha256 mismatch for ${pkg.file_name}: expected ${pkg.sha256}, got ${got}`);
  writeFileSync(dest, buf);
  return 'downloaded';
}

function copyDirIfStale(srcDir: string, destDir: string, stampValue: string): boolean {
  const stamp = join(destDir, '.vendor-stamp');
  if (existsSync(stamp) && readFileSync(stamp, 'utf8') === stampValue) return false;
  mkdirSync(destDir, { recursive: true });
  cpSync(srcDir, destDir, { recursive: true });
  writeFileSync(stamp, stampValue);
  return true;
}

async function main() {
  const t0 = Date.now();
  const pyodidePkg = JSON.parse(readFileSync(join(nm, 'pyodide', 'package.json'), 'utf8')) as { version: string };
  const version = pyodidePkg.version;
  mkdirSync(pyodideOut, { recursive: true });

  // 1. pyodide runtime
  let copied = 0;
  for (const f of PYODIDE_FILES) if (copyIfChanged(join(nm, 'pyodide', f), join(pyodideOut, f))) copied++;
  console.log(`[vendor] pyodide ${version}: ${copied ? `copied ${copied} file(s)` : 'up to date'}`);

  // 2. wheels (jedi + deps) from the Pyodide CDN, pinned by the lock file
  const lock = JSON.parse(readFileSync(join(nm, 'pyodide', 'pyodide-lock.json'), 'utf8')) as Lock;
  const wheels = resolveWheels(lock, WHEELS);
  const results = await Promise.all(wheels.map(async (w) => [w.file_name, await downloadWheel(version, w)] as const));
  for (const [name, state] of results) console.log(`[vendor] wheel ${name}: ${state}`);

  // 3. monaco
  const monacoVersion = (JSON.parse(readFileSync(join(nm, 'monaco-editor', 'package.json'), 'utf8')) as { version: string }).version;
  const monacoDone = copyDirIfStale(join(nm, 'monaco-editor', 'min', 'vs'), join(out, 'monaco', 'vs'), monacoVersion);
  console.log(`[vendor] monaco-editor ${monacoVersion}: ${monacoDone ? 'copied' : 'up to date'}`);

  // 4. ruff wasm (lang worker; logic owned by scripts/vendor-ruff.ts)
  vendorRuff();

  // 5. python shim manifest
  const manifest = buildPyManifest();
  console.log(`[vendor] py manifest: ${manifest.files.length} files (${manifest.hash})`);
  console.log(`[vendor] done in ${Date.now() - t0} ms`);
}

main().catch((err) => {
  console.error('[vendor] failed:', err instanceof Error ? err.message : err);
  // Don't break `npm install` for offline installs; `npm run vendor` is strict.
  process.exit(process.env.npm_lifecycle_event === 'postinstall' ? 0 : 1);
});
