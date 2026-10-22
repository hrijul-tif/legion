/**
 * Singleton client for workers/lang.worker.ts.
 *
 *   const lang = getLangClient();
 *   const diags = await lang.check(code);            // Ruff diagnostics (null if superseded by a newer call)
 *   const mos = await lang.mosCheck(code, 'FF');     // MOS001..MOS009 + parsed entry signature
 *   lang.getStatus().jedi                            // 'idle' | 'loading' | 'ready' | 'error'
 *
 * Every method resolves to `null` when a newer call of the same type superseded it (only the latest
 * request per type matters) and rejects when the underlying component failed to load.
 * The worker is created on first use and starts loading Ruff, then Pyodide, then jedi.
 *
 * React: `useSyncExternalStore(lang.subscribe, lang.getStatus, lang.getServerStatus)` drives a
 * "Python intelligence loading…" indicator.
 */
import type {
  ComponentState,
  LangEvent,
  LangRequest,
  LangResponse,
  LangResultMap,
  LangStatus,
  Mission,
} from './lang-protocol';

export type { LangStatus, ComponentState } from './lang-protocol';

type Pending = { type: string; resolve: (v: unknown) => void; reject: (e: Error) => void };

const INITIAL_STATUS: LangStatus = { ruff: 'idle', python: 'idle', jedi: 'idle', errors: {}, notes: [] };

export class LangClient {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private latestByType = new Map<string, number>();
  private listeners = new Set<() => void>();
  private status: LangStatus = INITIAL_STATUS;

  /** Stable references for useSyncExternalStore. */
  readonly subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };
  readonly getStatus = (): LangStatus => this.status;
  readonly getServerStatus = (): LangStatus => INITIAL_STATUS;

  /** Start the worker (and background loading) without waiting for a request. */
  warmup(): void {
    void this.ensureWorker();
  }

  /** Resolves when the component is ready; rejects if it failed to load. */
  whenReady(component: 'ruff' | 'python' | 'jedi'): Promise<void> {
    this.ensureWorker();
    return new Promise((resolve, reject) => {
      const settle = (): boolean => {
        const s = this.status[component];
        if (s === 'ready') resolve();
        else if (s === 'error') reject(new Error(this.status.errors[component] ?? `${component} failed to load`));
        else return false;
        return true;
      };
      if (settle()) return;
      const unsub = this.subscribe(() => {
        if (settle()) unsub();
      });
    });
  }

  isReady(component: 'ruff' | 'python' | 'jedi'): boolean {
    return this.status[component] === ('ready' as ComponentState);
  }

  check(code: string) {
    return this.request('check', { code });
  }
  format(code: string) {
    return this.request('format', { code });
  }
  mosCheck(code: string, mission: Mission | null, enums?: { commands: string[]; parameters: string[] }) {
    return this.request('mosCheck', { code, mission, enums });
  }
  /** `line`/`column` are Monaco positions (1-based). */
  complete(code: string, line: number, column: number) {
    return this.request('complete', { code, line, column });
  }
  completeResolve(index: number) {
    return this.request('completeResolve', { index });
  }
  hover(code: string, line: number, column: number) {
    return this.request('hover', { code, line, column });
  }
  signature(code: string, line: number, column: number) {
    return this.request('signature', { code, line, column });
  }
  definition(code: string, line: number, column: number) {
    return this.request('definition', { code, line, column });
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    for (const p of this.pending.values()) p.resolve(null);
    this.pending.clear();
    this.status = INITIAL_STATUS;
    this.emit();
  }

  /* ------------------------------------------------------------- internals */

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    if (typeof Worker === 'undefined') throw new Error('LangClient can only be used in the browser');
    const w = new Worker(new URL('../../workers/lang.worker.ts', import.meta.url), { type: 'module' });
    w.addEventListener('message', (ev: MessageEvent<LangResponse | LangEvent>) => this.onMessage(ev.data));
    w.addEventListener('error', (ev) => {
      const msg = ev.message || 'language worker crashed';
      this.status = {
        ...this.status,
        ruff: this.status.ruff === 'ready' ? 'ready' : 'error',
        python: this.status.python === 'ready' ? 'ready' : 'error',
        jedi: this.status.jedi === 'ready' ? 'ready' : 'error',
        errors: { ...this.status.errors, python: this.status.errors.python ?? msg },
      };
      this.emit();
    });
    this.worker = w;
    return w;
  }

  private request<K extends Exclude<LangRequest['type'], 'warmup' | 'status'>>(
    type: K,
    payload: Omit<Extract<LangRequest, { type: K }>, 'type'>,
  ): Promise<LangResultMap[K] | null> {
    const worker = this.ensureWorker();
    const id = this.nextId++;
    // Supersede older pending requests of the same type client-side.
    const prev = this.latestByType.get(type);
    if (prev !== undefined) {
      const p = this.pending.get(prev);
      if (p) {
        this.pending.delete(prev);
        p.resolve(null);
      }
    }
    this.latestByType.set(type, id);
    return new Promise<LangResultMap[K] | null>((resolve, reject) => {
      this.pending.set(id, { type, resolve: resolve as (v: unknown) => void, reject });
      worker.postMessage({ id, type, ...payload });
    });
  }

  private onMessage(msg: LangResponse | LangEvent) {
    if ('event' in msg) {
      this.status = { ...msg.status, errors: { ...msg.status.errors }, notes: [...msg.status.notes] };
      this.emit();
      return;
    }
    const p = this.pending.get(msg.id);
    if (!p) return; // superseded on the client already
    this.pending.delete(msg.id);
    if (msg.ok) p.resolve(msg.result);
    else if (msg.cancelled) p.resolve(null);
    else p.reject(new Error(msg.error));
  }

  private emit() {
    for (const l of this.listeners) l();
  }
}

let singleton: LangClient | null = null;

/** Lazily created singleton (browser only). */
export function getLangClient(): LangClient {
  if (!singleton) singleton = new LangClient();
  return singleton;
}
