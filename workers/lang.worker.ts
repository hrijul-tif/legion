/**
 * Language worker: Ruff (wasm) + Pyodide/jedi + MOS checks.
 *
 * Everything heavy is loaded lazily from same-origin /vendor (COOP/COEP safe, no bundler involvement):
 *   /vendor/ruff/ruff_wasm.js + ruff_wasm_bg.wasm   (scripts/vendor-ruff.ts)
 *   /vendor/pyodide/*                                (scripts/vendor-assets.ts)
 * Load order after the first request: Ruff (fast) -> Pyodide core + mos_lint -> jedi + framework shim.
 * Ruff requests never wait for Pyodide.
 *
 * Protocol: see lib/editor/lang-protocol.ts.
 */

// Turbopack emits this as a classic worker; Pyodide refuses classic workers, but dynamic import() works in both.
(self as unknown as { importScripts?: unknown }).importScripts = undefined;

import type { PyodideAPI } from 'pyodide';
import type * as RuffTypes from '@astral-sh/ruff-wasm-web';
import { RUFF_SETTINGS } from '../lib/editor/ruff-settings';
import type {
  ComponentState,
  LangRequest,
  LangRequestType,
  LangResponse,
  LangStatus,
  Mission,
  MosCheckResult,
  RuffDiagnostic,
} from '../lib/editor/lang-protocol';

type RuffModule = typeof RuffTypes;
type PyProxy = { toJs?: () => unknown; destroy?: () => void } & Record<string, (...a: unknown[]) => unknown>;

const ORIGIN = self.location.origin;
const RUFF_BASE = `${ORIGIN}/vendor/ruff/`;
const PYODIDE_BASE = `${ORIGIN}/vendor/pyodide/`;
const PY_BASE = `${ORIGIN}/py/`;
const PY_ROOT = '/home/pyodide/mos_py';

// A bundler-opaque dynamic import: these URLs are runtime-only static assets.
const dynamicImport = new Function('u', 'return import(u)') as (u: string) => Promise<unknown>;

/* ------------------------------------------------------------------ status */

const status: LangStatus = { ruff: 'idle', python: 'idle', jedi: 'idle', errors: {}, notes: [] };

function setState(key: 'ruff' | 'python' | 'jedi', state: ComponentState, error?: unknown) {
  status[key] = state;
  if (state === 'error') status.errors[key] = errMsg(error);
  else delete status.errors[key];
  self.postMessage({ event: 'status', status });
}

function note(text: string) {
  status.notes.push(text);
  self.postMessage({ event: 'status', status });
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/* -------------------------------------------------------------------- ruff */

let ruffWorkspace: InstanceType<RuffModule['Workspace']> | null = null;
let ruffReady: Promise<void> | null = null;

function startRuff(): Promise<void> {
  if (ruffReady) return ruffReady;
  setState('ruff', 'loading');
  ruffReady = (async () => {
    const mod = (await dynamicImport(`${RUFF_BASE}ruff_wasm.js`)) as RuffModule;
    await mod.default({ module_or_path: `${RUFF_BASE}ruff_wasm_bg.wasm` });
    ruffWorkspace = new mod.Workspace(RUFF_SETTINGS, mod.PositionEncoding.Utf16);
    setState('ruff', 'ready');
  })().catch((e) => {
    setState('ruff', 'error', e);
    throw e;
  });
  ruffReady.catch(() => undefined);
  return ruffReady;
}

function ruffCheck(code: string): RuffDiagnostic[] {
  const raw = ruffWorkspace!.check(code) as RuffTypes.Diagnostic[];
  return raw.map((d) => ({
    code: d.code ?? 'invalid-syntax',
    message: d.message,
    tags: d.tags ?? [],
    startLine: d.start_location.row,
    startColumn: d.start_location.column,
    endLine: d.end_location.row,
    endColumn: d.end_location.column,
    fix: d.fix
      ? {
          message: d.fix.message,
          edits: d.fix.edits.map((e) => ({
            content: e.content ?? '',
            startLine: e.location.row,
            startColumn: e.location.column,
            endLine: e.end_location.row,
            endColumn: e.end_location.column,
          })),
        }
      : null,
  }));
}

/* ------------------------------------------------------------ pyodide/jedi */

let pyodide: PyodideAPI | null = null;
let pythonReady: Promise<void> | null = null;
let jediReady: Promise<void> | null = null;
let lint: PyProxy | null = null;
let intel: PyProxy | null = null;

const MOS_LINT_FILES = ['mos_lint/__init__.py', 'mos_lint/check.py', 'mos_lint/intel.py'];

/** Tolerant reader for /py/manifest.json (the runtime agent defines the exact shape). */
function manifestHash(manifest: unknown): string {
  const h = (manifest as { hash?: unknown } | null)?.hash;
  return typeof h === 'string' ? h : '';
}

function manifestPaths(manifest: unknown): string[] {
  const out: string[] = [];
  const visit = (v: unknown, depth: number) => {
    if (depth > 3 || v == null) return;
    if (typeof v === 'string') out.push(v);
    else if (Array.isArray(v)) v.forEach((x) => visit(x, depth + 1));
    else if (typeof v === 'object') {
      const o = v as Record<string, unknown>;
      const p = o.path ?? o.file ?? o.name ?? o.url;
      if (typeof p === 'string') out.push(p);
      else if (o.files !== undefined) visit(o.files, depth + 1);
      else for (const k of Object.keys(o)) if (/\.pyi?$/.test(k)) out.push(k);
    }
  };
  visit(manifest, 0);
  return out
    .map((p) => p.replace(/^https?:\/\/[^/]+/, '').replace(/^\/?py\//, '').replace(/^\/+/, ''))
    .filter((p) => /\.pyi?$/.test(p));
}

/** Cache-busting token from /py/manifest.json (`hash`), appended as `?v=` to every /py file. */
let pyVersion = '';

async function fetchText(url: string): Promise<string> {
  const r = await fetch(pyVersion ? `${url}?v=${pyVersion}` : url);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}: ${url}`);
  return r.text();
}

function writeFile(py: PyodideAPI, rel: string, text: string) {
  const full = `${PY_ROOT}/${rel}`;
  py.FS.mkdirTree(full.slice(0, full.lastIndexOf('/')));
  py.FS.writeFile(full, text);
}

function startPython(): Promise<void> {
  if (pythonReady) return pythonReady;
  setState('python', 'loading');
  pythonReady = (async () => {
    const { loadPyodide } = (await dynamicImport(`${PYODIDE_BASE}pyodide.mjs`)) as {
      loadPyodide: (o: Record<string, unknown>) => Promise<PyodideAPI>;
    };
    const py = await loadPyodide({ indexURL: PYODIDE_BASE, stdout: () => undefined, stderr: () => undefined });
    py.FS.mkdirTree(PY_ROOT);

    const paths = new Set(MOS_LINT_FILES);
    try {
      const manifest = await (await fetch(`${PY_BASE}manifest.json`, { cache: 'no-cache' })).json();
      pyVersion = manifestHash(manifest);
      for (const p of manifestPaths(manifest)) if (p.startsWith('mos_lint/')) paths.add(p);
    } catch {
      /* manifest not available yet: the hardcoded mos_lint list is enough */
    }
    await Promise.all(
      [...paths].map(async (p) => writeFile(py, p, await fetchText(`${PY_BASE}${p}`))),
    );
    py.runPython(
      `import sys, importlib\nif ${JSON.stringify(PY_ROOT)} not in sys.path: sys.path.insert(0, ${JSON.stringify(PY_ROOT)})\nimportlib.invalidate_caches()`,
    );
    lint = py.pyimport('mos_lint') as unknown as PyProxy;
    pyodide = py;
    setState('python', 'ready');
  })().catch((e) => {
    setState('python', 'error', e);
    throw e;
  });
  pythonReady.catch(() => undefined);
  return pythonReady;
}

async function loadFrameworkShim(py: PyodideAPI) {
  let manifest: unknown;
  try {
    const r = await fetch(`${PY_BASE}manifest.json`, { cache: 'no-cache' });
    if (!r.ok) throw new Error(String(r.status));
    manifest = await r.json();
    pyVersion = manifestHash(manifest) || pyVersion;
  } catch {
    note('framework shim manifest (/py/manifest.json) not found: jedi runs without framework stubs');
    return;
  }
  const files = manifestPaths(manifest).filter((p) => p.startsWith('framework/'));
  if (!files.length) {
    note('no framework/* files in /py/manifest.json: jedi runs without framework stubs');
    return;
  }
  const results = await Promise.allSettled(
    files.map(async (p) => writeFile(py, p, await fetchText(`${PY_BASE}${p}`))),
  );
  const failed = results.filter((r) => r.status === 'rejected').length;
  if (failed) note(`${failed} framework shim file(s) failed to load`);
}

function startJedi(): Promise<void> {
  if (jediReady) return jediReady;
  setState('jedi', 'loading');
  jediReady = (async () => {
    await startPython();
    const py = pyodide!;
    await Promise.all([py.loadPackage(['parso', 'jedi'], { messageCallback: () => undefined }), loadFrameworkShim(py)]);
    py.runPython('import importlib; importlib.invalidate_caches()');
    intel = py.pyimport('mos_lint.intel') as unknown as PyProxy;
    setState('jedi', 'ready');
  })().catch((e) => {
    setState('jedi', 'error', e);
    throw e;
  });
  jediReady.catch(() => undefined);
  return jediReady;
}

/** Kick off loading in order without blocking: Ruff first, then Pyodide, then jedi. */
let warming = false;
function warmup() {
  if (warming) return;
  warming = true;
  void startRuff()
    .catch(() => undefined)
    .then(() => startPython())
    .catch(() => undefined)
    .then(() => startJedi())
    .catch(() => undefined);
}

/* -------------------------------------------------------------- dispatching */

// Only the most recent request of each type is answered; older ones that are still waiting are cancelled.
const latest = new Map<LangRequestType, number>();

class Cancelled extends Error {}

function callIntel<T>(fn: string, ...args: unknown[]): T {
  const raw = intel![fn](...args) as string;
  return JSON.parse(raw) as T;
}

async function handle(req: LangRequest, id: number): Promise<unknown> {
  const stale = () => {
    if (latest.get(req.type) !== id) throw new Cancelled();
  };
  switch (req.type) {
    case 'warmup':
    case 'status':
      return status;
    case 'check': {
      await startRuff();
      stale();
      return ruffCheck(req.code);
    }
    case 'format': {
      await startRuff();
      stale();
      return { code: ruffWorkspace!.format(req.code) };
    }
    case 'mosCheck': {
      await startPython();
      stale();
      const enums = req.enums ? JSON.stringify(req.enums) : undefined;
      const raw = lint!.mos_check_json(req.code, req.mission as Mission | null, enums) as string;
      return JSON.parse(raw) as MosCheckResult;
    }
    case 'complete': {
      await startJedi();
      stale();
      return callIntel('complete', req.code, req.line, req.column - 1);
    }
    case 'completeResolve': {
      await startJedi();
      stale();
      return callIntel('resolve', req.index);
    }
    case 'hover': {
      await startJedi();
      stale();
      return callIntel('hover', req.code, req.line, req.column - 1);
    }
    case 'signature': {
      await startJedi();
      stale();
      return callIntel('signature', req.code, req.line, req.column - 1);
    }
    case 'definition': {
      await startJedi();
      stale();
      return callIntel('definition', req.code, req.line, req.column - 1);
    }
  }
}

self.addEventListener('message', (ev: MessageEvent<{ id: number } & LangRequest>) => {
  const { id, ...req } = ev.data;
  latest.set(req.type, id);
  warmup();
  handle(req as LangRequest, id).then(
    (result) => {
      // A result computed synchronously is still delivered even if a newer request arrived meanwhile.
      const res: LangResponse = { id, ok: true, result };
      self.postMessage(res);
    },
    (e) => {
      const res: LangResponse =
        e instanceof Cancelled
          ? { id, ok: false, error: 'cancelled', cancelled: true }
          : { id, ok: false, error: errMsg(e) };
      self.postMessage(res);
    },
  );
});

self.postMessage({ event: 'status', status });
