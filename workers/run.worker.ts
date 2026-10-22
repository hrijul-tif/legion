/**
 * Procedure run worker: Pyodide + the mos-framework shim + the mock spacecraft (public/py).
 *
 * Python blocks this thread while a procedure runs, so everything the UI does during a run goes through
 * SharedArrayBuffers (lib/sandbox/types.ts): the interrupt byte (Stop), the prompt answer word and the
 * mailbox (telemetry overrides, fault toggles, warp). Protocol: lib/sandbox/types.ts (ToWorker/FromWorker).
 */

// Turbopack emits this as a classic worker; Pyodide refuses classic workers, but dynamic import() works in both.
(self as unknown as { importScripts?: unknown }).importScripts = undefined;

import type { PyodideAPI } from 'pyodide';
import {
  CTL,
  MAILBOX_BYTES,
  type DoneEvent,
  type FromWorker,
  type Mission,
  type RunEvent,
  type RunRequest,
  type SharedBuffers,
  type SignatureResult,
  type ToWorker,
} from '../lib/sandbox/types';

const ORIGIN = self.location.origin;
const PYODIDE_BASE = `${ORIGIN}/vendor/pyodide/`;
const PY_BASE = `${ORIGIN}/py/`;
const PY_ROOT = '/home/pyodide/mos';

// Opaque to the bundler: these are runtime-only static assets served from /vendor.
const dynamicImport = new Function('u', 'return import(u)') as (u: string) => Promise<unknown>;

const post = (m: FromWorker) => (self as unknown as { postMessage(m: unknown): void }).postMessage(m);

type PyFn = (...a: unknown[]) => unknown;

let pyodide: PyodideAPI | null = null;
let runner: { run: PyFn } | null = null;
let procInfo: { inspect_json: PyFn } | null = null;
let ready: Promise<void> | null = null;

let interrupt: Uint8Array;
let ctl: Int32Array;
let mailbox: Uint8Array;

const catalogsLoaded = new Set<string>();

/* ------------------------------------------------------------- event batching */

let currentRunId = '';
let pending: RunEvent[] = [];
let lastFlush = 0;

function flush() {
  if (!pending.length) return;
  const events = pending;
  pending = [];
  lastFlush = performance.now();
  post({ type: 'events', runId: currentRunId, events });
}

function pushEvent(ev: RunEvent) {
  pending.push(ev);
  if (pending.length >= 100 || performance.now() - lastFlush > 30) flush();
}

/* ------------------------------------------------------------------- bridge */

const bridge = {
  emit(json: string) {
    const v = JSON.parse(json) as RunEvent | RunEvent[];
    if (Array.isArray(v)) v.forEach(pushEvent);
    else pushEvent(v);
  },
  /** Blocking sleep in short slices; true when the UI asked to stop. */
  sleep(seconds: number): boolean {
    flush();
    const end = performance.now() + seconds * 1000;
    for (;;) {
      if (Atomics.load(interrupt, 0) !== 0) return true;
      const remaining = end - performance.now();
      if (remaining <= 0) return false;
      Atomics.wait(ctl, CTL.SLEEP, 0, Math.min(remaining, 50));
    }
  },
  /** Posts the prompt event and blocks until the UI answers. Returns the choice index, -1 when interrupted. */
  prompt(json: string): number {
    const ev = JSON.parse(json) as RunEvent;
    Atomics.store(ctl, CTL.PROMPT, 0);
    pushEvent(ev);
    flush();
    for (;;) {
      if (Atomics.load(interrupt, 0) !== 0) return -1;
      const v = Atomics.load(ctl, CTL.PROMPT);
      if (v !== 0) {
        Atomics.store(ctl, CTL.PROMPT, 0);
        return v - 1;
      }
      Atomics.wait(ctl, CTL.PROMPT, 0, 50);
    }
  },
  /** JSON array of pending control messages ('' when none). */
  read_mailbox(): string {
    if (Atomics.load(ctl, CTL.MAIL_LEN) === 0) return '';
    while (Atomics.compareExchange(ctl, CTL.LOCK, 0, 1) !== 0) {
      /* spin: the writer holds the lock for a few microseconds */
    }
    let text = '';
    try {
      const len = Atomics.load(ctl, CTL.MAIL_LEN);
      if (len > 0) {
        text = new TextDecoder().decode(mailbox.slice(0, Math.min(len, MAILBOX_BYTES)));
        Atomics.store(ctl, CTL.MAIL_LEN, 0);
      }
    } finally {
      Atomics.store(ctl, CTL.LOCK, 0);
    }
    const lines = text.split('\n').filter(Boolean);
    return lines.length ? `[${lines.join(',')}]` : '';
  },
  interrupted(): boolean {
    return Atomics.load(interrupt, 0) !== 0;
  },
  clear_interrupt() {
    Atomics.store(interrupt, 0, 0);
  },
};

/* --------------------------------------------------------------------- boot */

async function boot(buffers: SharedBuffers): Promise<void> {
  interrupt = new Uint8Array(buffers.interrupt);
  ctl = new Int32Array(buffers.ctl);
  mailbox = new Uint8Array(buffers.mailbox);

  const mod = (await dynamicImport(`${PYODIDE_BASE}pyodide.mjs`)) as {
    loadPyodide: (o: { indexURL: string }) => Promise<PyodideAPI>;
  };
  const py = await mod.loadPyodide({ indexURL: PYODIDE_BASE });
  py.setInterruptBuffer(interrupt);
  py.registerJsModule('mos_bridge', bridge);

  const manifest = (await (await fetch(`${PY_BASE}manifest.json`, { cache: 'no-cache' })).json()) as {
    hash?: string;
    files: string[];
  };
  const v = manifest.hash ? `?v=${manifest.hash}` : '';
  const files = await Promise.all(
    manifest.files.map(async (f) => {
      const r = await fetch(`${PY_BASE}${f}${v}`);
      if (!r.ok) throw new Error(`failed to load /py/${f}: ${r.status}`);
      return [f, await r.text()] as const;
    }),
  );
  const made = new Set<string>();
  for (const [f, text] of files) {
    const path = `${PY_ROOT}/${f}`;
    const dir = path.slice(0, path.lastIndexOf('/'));
    if (!made.has(dir)) {
      py.FS.mkdirTree(dir);
      made.add(dir);
    }
    py.FS.writeFile(path, text);
  }
  py.FS.mkdirTree('/catalog');
  py.FS.mkdirTree('/sim');
  py.runPython(`import sys\nif ${JSON.stringify(PY_ROOT)} not in sys.path:\n    sys.path.insert(0, ${JSON.stringify(PY_ROOT)})`);
  // warm-up: import the shim once so the first run starts fast
  py.runPython('import mos_sim.runner, mos_sim.procedure_info, framework.mdb.super_class');
  runner = py.pyimport('mos_sim.runner') as unknown as { run: PyFn };
  procInfo = py.pyimport('mos_sim.procedure_info') as unknown as { inspect_json: PyFn };
  pyodide = py;
}

async function loadCatalog(mission: Mission): Promise<string | null> {
  const key = mission.toLowerCase();
  if (catalogsLoaded.has(key) || !pyodide) return null;
  const r = await fetch(`/catalog/${key}.json`, { cache: 'no-cache' });
  if (!r.ok) return `catalog /catalog/${key}.json not found (${r.status})`;
  pyodide.FS.writeFile(`/catalog/${key}.json`, await r.text());
  catalogsLoaded.add(key);
  return null;
}

async function loadSim(mission: Mission): Promise<void> {
  if (!pyodide) return;
  const path = `/sim/${mission.toLowerCase()}-sim.json`;
  try {
    const r = await fetch(path, { cache: 'no-store' });
    if (r.ok) {
      pyodide.FS.writeFile(path, await r.text());
      return;
    }
  } catch {
    /* fall through to removal */
  }
  try {
    pyodide.FS.unlink(path);
  } catch {
    /* not there */
  }
}

/* ---------------------------------------------------------------------- run */

function doneEvent(partial: Partial<DoneEvent> & { outcome: DoneEvent['outcome'] }): DoneEvent {
  return {
    type: 'done',
    t: partial.virtualSeconds ?? 0,
    wall: Date.now(),
    virtualSeconds: 0,
    wallMs: 0,
    ...partial,
  };
}

async function executeRun(runId: string, req: RunRequest) {
  currentRunId = runId;
  pending = [];
  lastFlush = performance.now();
  const started = performance.now();
  let done: DoneEvent;
  try {
    const catalogProblem = await loadCatalog(req.mission);
    if (!req.options.sim) await loadSim(req.mission);
    Atomics.store(interrupt, 0, 0);
    Atomics.store(ctl, CTL.PROMPT, 0);
    if (catalogProblem) {
      pushEvent({ type: 'log', level: 'warning', msg: catalogProblem, logger: 'sim', t: 0, wall: Date.now() });
    }
    const options = { ...req.options, warp: Number.isFinite(req.options.warp) ? req.options.warp : 'inf' };
    const payload = JSON.stringify({ code: req.code, entrypoint: req.entrypoint, args: req.args, mission: req.mission, options });
    const res = JSON.parse(runner!.run(payload) as string) as {
      outcome: DoneEvent['outcome'];
      error: string | null;
      traceback: string | null;
      returnValue: string | null;
      virtualSeconds: number;
      wallMs: number;
    };
    done = doneEvent({
      outcome: res.outcome,
      error: res.error ?? undefined,
      traceback: res.traceback ?? undefined,
      returnValue: res.returnValue ?? undefined,
      virtualSeconds: res.virtualSeconds,
      wallMs: res.wallMs,
    });
  } catch (e) {
    // an exception escaping the python runner (it maps everything to an outcome, so this is unexpected)
    const message = e instanceof Error ? e.message : String(e);
    const interrupted = Atomics.load(interrupt, 0) !== 0 || /KeyboardInterrupt/.test(message);
    done = doneEvent({
      outcome: interrupted ? 'stopped' : 'error',
      error: interrupted ? 'Stopped by the operator' : message.trim().split('\n').pop() || message,
      traceback: interrupted ? undefined : message,
      wallMs: Math.round(performance.now() - started),
    });
  }
  Atomics.store(interrupt, 0, 0);
  pushEvent(done);
  flush();
}

async function executeInspect(reqId: number, code: string, mission: Mission, entrypoint?: string) {
  let result: SignatureResult;
  try {
    await loadCatalog(mission);
    result = JSON.parse(procInfo!.inspect_json(code, mission, entrypoint ?? null) as string) as SignatureResult;
  } catch (e) {
    result = { type: 'signature', entrypoint: null, params: [], candidates: [], error: e instanceof Error ? e.message : String(e) };
  }
  post({ type: 'signature', reqId, result });
}

/* ------------------------------------------------------------------- entry */

(self as unknown as { onmessage: (e: MessageEvent<ToWorker>) => void }).onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'init') {
    ready = boot(msg.buffers).then(
      () => post({ type: 'ready' }),
      (err) => post({ type: 'fatal', message: err instanceof Error ? err.message : String(err) }),
    );
    return;
  }
  void (async () => {
    await ready;
    if (!pyodide) return;
    if (msg.type === 'run') await executeRun(msg.runId, msg.req);
    else if (msg.type === 'inspect') await executeInspect(msg.reqId, msg.code, msg.mission, msg.entrypoint);
  })();
};
