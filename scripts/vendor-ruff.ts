/**
 * Copies the Ruff wasm bundle to public/vendor/ruff/ so the lang worker can load it same-origin
 * (COOP/COEP: no CDN).  Idempotent.  Run: `tsx scripts/vendor-ruff.ts`, or import `vendorRuff()`
 * from the main vendor flow.
 */
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'node_modules', '@astral-sh', 'ruff-wasm-web');
const DEST = join(ROOT, 'public', 'vendor', 'ruff');
const FILES = ['ruff_wasm.js', 'ruff_wasm_bg.wasm'];

export function vendorRuff(): void {
  if (!existsSync(SRC)) {
    console.warn('[vendor-ruff] @astral-sh/ruff-wasm-web is not installed; skipping');
    return;
  }
  mkdirSync(DEST, { recursive: true });
  for (const f of FILES) {
    const from = join(SRC, f);
    const to = join(DEST, f);
    if (existsSync(to) && statSync(to).size === statSync(from).size) continue;
    copyFileSync(from, to);
    console.log(`[vendor-ruff] ${f} -> public/vendor/ruff/`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) vendorRuff();
