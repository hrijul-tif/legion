/**
 * Client of the procedure run worker (workers/run.worker.ts). Browser only: nothing here touches Worker at
 * import time, so it is safe to import from client components that are also rendered on the server.
 *
 *   const client = getRunClient();
 *   await client.ensureReady();
 *   const sig = await client.inspect(code);
 *   const done = await client.run(req, (ev) => ...);
 *   client.answerPrompt(promptId, '1: Retry command');
 *   client.setTelemetry('/FF/OBC/Reset_Counter', 5);
 *   client.setFaults([{ kind: 'command_fails', match: '', once: true }]);
 *   await client.stop();
 */
import {
  CTL,
  CTL_WORDS,
  MAILBOX_BYTES,
  SandboxUnavailableError,
  type DoneEvent,
  type Fault,
  type FromWorker,
  type Mission,
  type PromptEvent,
  type RunEvent,
  type RunRequest,
  type SharedBuffers,
  type SignatureResult,
  type ToWorker,
} from './types';

export type { Fault, RunEvent, RunRequest, SignatureResult, DoneEvent, PromptEvent, Mission } from './types';
export { SandboxUnavailableError } from './types';

/** How long Stop waits for the interrupt to take effect before the worker is terminated. */
export const STOP_GRACE_MS = 1500;
const SIGINT = 2;

interface ActiveRun {
  runId: string;
  onEvent: (ev: RunEvent) => void;
  resolve: (done: DoneEvent) => void;
}

export class RunClient {
  private worker: Worker | null = null;
  private readyPromise: Promise<void> | null = null;
  private buffers: SharedBuffers | null = null;
  private interrupt: Uint8Array | null = null;
  private ctl: Int32Array | null = null;
  private mailbox: Uint8Array | null = null;

  private active: ActiveRun | null = null;
  private pendingPrompt: PromptEvent | null = null;
  private stopTimer: ReturnType<typeof setTimeout> | null = null;
  private stopWaiters: Array<() => void> = [];

  private overrides: Record<string, unknown> = {};
  private mailQueue: string[] = [];
  private mailTimer: ReturnType<typeof setTimeout> | null = null;

  private inspectSeq = 0;
  private inspectWaiters = new Map<number, (r: SignatureResult) => void>();

  /** True while a run is in flight (also while it waits on a prompt). */
  get running(): boolean {
    return this.active !== null;
  }

  /** Prompt currently waiting for an answer, if any. */
  get currentPrompt(): PromptEvent | null {
    return this.pendingPrompt;
  }

  /** Boots the worker (Pyodide + shim) if needed. Rejects with SandboxUnavailableError when SharedArrayBuffer is unavailable. */
  ensureReady(): Promise<void> {
    if (typeof window === 'undefined') return Promise.reject(new SandboxUnavailableError('The sandbox only runs in the browser'));
    if (!window.crossOriginIsolated || typeof SharedArrayBuffer === 'undefined') {
      return Promise.reject(
        new SandboxUnavailableError(
          'The page is not cross-origin isolated (missing Cross-Origin-Opener-Policy: same-origin / Cross-Origin-Embedder-Policy: require-corp headers), so SharedArrayBuffer is unavailable and procedures cannot run.',
        ),
      );
    }
    if (this.readyPromise) return this.readyPromise;
    this.readyPromise = this.boot().catch((err) => {
      this.discardWorker();
      throw err;
    });
    return this.readyPromise;
  }

  private boot(): Promise<void> {
    this.buffers = {
      interrupt: new SharedArrayBuffer(4),
      ctl: new SharedArrayBuffer(4 * CTL_WORDS),
      mailbox: new SharedArrayBuffer(MAILBOX_BYTES),
    };
    this.interrupt = new Uint8Array(this.buffers.interrupt);
    this.ctl = new Int32Array(this.buffers.ctl);
    this.mailbox = new Uint8Array(this.buffers.mailbox);

    const worker = new Worker(new URL('../../workers/run.worker.ts', import.meta.url), { type: 'module' });
    this.worker = worker;
    return new Promise<void>((resolve, reject) => {
      worker.onmessage = (e: MessageEvent<FromWorker>) => {
        const msg = e.data;
        if (msg.type === 'ready') {
          worker.onmessage = (ev: MessageEvent<FromWorker>) => this.handle(ev.data);
          resolve();
        } else if (msg.type === 'fatal') {
          reject(new Error(`Sandbox failed to start: ${msg.message}`));
        }
      };
      worker.onerror = (e) => {
        const err = new Error(`Sandbox worker error: ${e.message || 'unknown error'}`);
        if (this.active) this.finishActive(this.syntheticDone('error', err.message));
        reject(err);
        this.discardWorker();
      };
      const init: ToWorker = { type: 'init', buffers: this.buffers! };
      worker.postMessage(init);
    });
  }

  private discardWorker() {
    this.worker?.terminate();
    this.worker = null;
    this.readyPromise = null;
    this.inspectWaiters.forEach((w) => w({ type: 'signature', entrypoint: null, params: [], candidates: [], error: 'sandbox restarted' }));
    this.inspectWaiters.clear();
  }

  private handle(msg: FromWorker) {
    if (msg.type === 'events') {
      const run = this.active;
      if (!run || msg.runId !== run.runId) return;
      for (const ev of msg.events) {
        if (ev.type === 'prompt') this.pendingPrompt = ev;
        run.onEvent(ev);
        if (ev.type === 'done') {
          this.finishActive(ev);
          return;
        }
      }
    } else if (msg.type === 'signature') {
      this.inspectWaiters.get(msg.reqId)?.(msg.result);
      this.inspectWaiters.delete(msg.reqId);
    } else if (msg.type === 'fatal') {
      if (this.active) this.finishActive(this.syntheticDone('error', msg.message));
    }
  }

  private syntheticDone(outcome: DoneEvent['outcome'], error: string): DoneEvent {
    return { type: 'done', t: 0, wall: Date.now(), outcome, error, virtualSeconds: 0, wallMs: 0 };
  }

  private finishActive(done: DoneEvent) {
    const run = this.active;
    if (!run) return;
    this.active = null;
    this.pendingPrompt = null;
    if (this.stopTimer) clearTimeout(this.stopTimer);
    this.stopTimer = null;
    if (this.interrupt) Atomics.store(this.interrupt, 0, 0);
    run.resolve(done);
    const waiters = this.stopWaiters;
    this.stopWaiters = [];
    waiters.forEach((w) => w());
  }

  /** Statically analyses a procedure (entrypoint + argument list). Rejects with Error('busy') while a run is in flight. */
  async inspect(code: string, mission: Mission = 'FF', entrypoint?: string): Promise<SignatureResult> {
    if (this.active) throw new Error('busy');
    await this.ensureReady();
    const reqId = ++this.inspectSeq;
    return new Promise<SignatureResult>((resolve) => {
      this.inspectWaiters.set(reqId, resolve);
      const m: ToWorker = { type: 'inspect', reqId, code, mission, entrypoint };
      this.worker!.postMessage(m);
    });
  }

  /** Runs a procedure. Resolves with the `done` event (never rejects for procedure failures). */
  async run(req: RunRequest, onEvent: (ev: RunEvent) => void): Promise<DoneEvent> {
    if (this.active) throw new Error('A run is already in progress');
    await this.ensureReady();
    if (this.active) throw new Error('A run is already in progress');
    const runId = req.runId ?? (globalThis.crypto?.randomUUID?.() ?? `run-${Date.now()}`);
    return new Promise<DoneEvent>((resolve) => {
      this.active = { runId, onEvent, resolve };
      this.pendingPrompt = null;
      this.mailQueue = [];
      this.resetControlState();
      const full: RunRequest = {
        ...req,
        runId,
        options: { ...req.options, telemetry: { ...this.overrides, ...(req.options.telemetry ?? {}) } },
      };
      const m: ToWorker = { type: 'run', runId, req: full };
      this.worker!.postMessage(m);
    });
  }

  private resetControlState() {
    Atomics.store(this.interrupt!, 0, 0);
    Atomics.store(this.ctl!, CTL.PROMPT, 0);
    this.withMailLock(() => Atomics.store(this.ctl!, CTL.MAIL_LEN, 0));
  }

  /** Answers the pending prompt with the choice text or its index. */
  answerPrompt(id: string, choice: string | number): void {
    const p = this.pendingPrompt;
    if (!p || p.id !== id || !this.ctl) return;
    const idx = typeof choice === 'number' ? choice : p.choices.indexOf(choice);
    if (idx < 0 || idx >= p.choices.length) throw new Error(`"${String(choice)}" is not one of the prompt's choices`);
    this.pendingPrompt = null;
    Atomics.store(this.ctl, CTL.PROMPT, idx + 1);
    Atomics.notify(this.ctl, CTL.PROMPT);
  }

  /** Overrides a telemetry value (applies immediately during a run; remembered for later runs). */
  setTelemetry(q: string, value: unknown): void {
    this.overrides[q] = value;
    this.postControl({ kind: 'telemetry', q, value });
  }

  /** Forget the remembered overrides (they are re-applied at the start of every run). */
  clearTelemetryOverrides(): void {
    this.overrides = {};
  }

  /** Replaces the active fault list (toggles apply immediately during a run). */
  setFaults(faults: Fault[]): void {
    this.postControl({ kind: 'faults', faults });
  }

  /** Changes the warp factor of the running procedure. */
  setWarp(warp: number): void {
    this.postControl({ kind: 'warp', value: Number.isFinite(warp) ? warp : 'inf' });
  }

  /** Stops the running procedure (KeyboardInterrupt -> outcome 'stopped'); terminates the worker if it does not stop in time. */
  stop(): Promise<void> {
    if (!this.active) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.stopWaiters.push(resolve);
      this.pendingPrompt = null;
      Atomics.store(this.interrupt!, 0, SIGINT);
      Atomics.notify(this.ctl!, CTL.PROMPT);
      if (this.stopTimer) return;
      this.stopTimer = setTimeout(() => {
        this.stopTimer = null;
        if (!this.active) return;
        const done = this.syntheticDone('stopped', 'Stopped (the sandbox did not respond and was restarted)');
        this.discardWorker();
        this.finishActive(done);
        // warm up a fresh worker in the background; the next run awaits it through ensureReady()
        this.ensureReady().catch(() => undefined);
      }, STOP_GRACE_MS);
    });
  }

  /** Terminates the worker. The client can be used again afterwards (a new worker boots on demand). */
  dispose(): void {
    if (this.active) this.finishActive(this.syntheticDone('stopped', 'Sandbox disposed'));
    this.discardWorker();
  }

  /* --------------------------------------------------------------- mailbox */

  private postControl(msg: object) {
    this.mailQueue.push(JSON.stringify(msg) + '\n');
    this.flushMail();
  }

  private withMailLock<T>(fn: () => T): T {
    const ctl = this.ctl!;
    // the worker holds the lock for microseconds only
    for (let spins = 0; Atomics.compareExchange(ctl, CTL.LOCK, 0, 1) !== 0; spins++) {
      if (spins > 5_000_000) throw new Error('sandbox mailbox lock timeout');
    }
    try {
      return fn();
    } finally {
      Atomics.store(ctl, CTL.LOCK, 0);
    }
  }

  private flushMail() {
    if (!this.active || !this.ctl || !this.mailbox) {
      // nothing is listening outside a run; overrides are re-sent at the next run start, faults come with its options
      this.mailQueue = [];
      return;
    }
    const enc = new TextEncoder();
    this.withMailLock(() => {
      let len = Atomics.load(this.ctl!, CTL.MAIL_LEN);
      while (this.mailQueue.length) {
        const bytes = enc.encode(this.mailQueue[0]);
        if (len + bytes.length > MAILBOX_BYTES) break;
        this.mailbox!.set(bytes, len);
        len += bytes.length;
        this.mailQueue.shift();
      }
      Atomics.store(this.ctl!, CTL.MAIL_LEN, len);
    });
    if (this.mailQueue.length && !this.mailTimer) {
      this.mailTimer = setTimeout(() => {
        this.mailTimer = null;
        this.flushMail();
      }, 50);
    }
  }
}

let singleton: RunClient | null = null;

/** Shared client (one worker per tab). */
export function getRunClient(): RunClient {
  if (!singleton) singleton = new RunClient();
  return singleton;
}
