/**
 * Serialised, coalescing autosave.
 *
 * - at most one save in flight; edits made meanwhile are saved by the next loop iteration with the latest text
 * - debounced (800 ms) after typing; `flush()` saves now and resolves when the latest text is on the server
 * - failures keep the text (the caller mirrors it to localStorage through `onLocal`) and retry with backoff
 */

export type SaveStatus = "saved" | "saving" | "unsaved" | "offline";

export interface SaveState {
  status: SaveStatus;
  /** epoch ms of the last successful save (null before the first one) */
  savedAt: number | null;
  /** last failure message while `offline` */
  error: string | null;
  /** a failure that retrying cannot fix (not the author, frozen...) */
  fatal: boolean;
}

export type SaveResult = { ok: true } | { ok: false; error: string };

export interface SaveQueueOptions {
  save(code: string): Promise<SaveResult>;
  /** text currently on the server */
  initialSaved: string;
  initialSavedAt?: number | null;
  onState(state: SaveState): void;
  /** mirror unsaved text locally (called with null once everything is saved) */
  onLocal?(code: string | null): void;
  debounceMs?: number;
  backoffMs?: number[];
  isFatal?(error: string): boolean;
  now?(): number;
}

const DEFAULT_BACKOFF = [2000, 4000, 8000, 15000, 30000];
const DEFAULT_FATAL = /frozen|only the author|not found|too large/i;

export class SaveQueue {
  private latest: string;
  private saved: string;
  private savedAt: number | null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<void> | null = null;
  private failures = 0;
  private disposed = false;
  private state: SaveState;

  constructor(private readonly opts: SaveQueueOptions) {
    this.latest = opts.initialSaved;
    this.saved = opts.initialSaved;
    this.savedAt = opts.initialSavedAt ?? null;
    this.state = {
      status: "saved",
      savedAt: this.savedAt,
      error: null,
      fatal: false,
    };
  }

  get snapshot(): SaveState {
    return this.state;
  }

  get dirty(): boolean {
    return this.latest !== this.saved;
  }

  /** Call on every edit with the full buffer. */
  setCode(code: string): void {
    this.latest = code;
    if (this.disposed) return;
    if (code === this.saved) {
      this.clearTimers();
      this.opts.onLocal?.(null);
      if (!this.running) this.emit("saved");
      return;
    }
    this.opts.onLocal?.(code);
    if (!this.running && this.state.status !== "offline") this.emit("unsaved");
    if (this.state.fatal) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.drain();
    }, this.opts.debounceMs ?? 800);
  }

  /** Saves right now. Resolves true when the latest text is on the server. */
  async flush(): Promise<boolean> {
    this.clearTimers();
    await this.drain();
    return this.latest === this.saved;
  }

  /** Marks `code` as the server's text (e.g. after the user discarded/restored a local copy elsewhere). */
  reset(code: string): void {
    this.latest = code;
    this.saved = code;
    this.failures = 0;
    this.clearTimers();
    this.emit("saved");
  }

  dispose(): void {
    this.disposed = true;
    this.clearTimers();
  }

  private clearTimers() {
    if (this.timer) clearTimeout(this.timer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.timer = null;
    this.retryTimer = null;
  }

  private emit(status: SaveStatus, error: string | null = null, fatal = false) {
    this.state = { status, savedAt: this.savedAt, error, fatal };
    this.opts.onState(this.state);
  }

  private drain(): Promise<void> {
    if (this.running) return this.running;
    const now = this.opts.now ?? Date.now;
    this.running = (async () => {
      while (!this.disposed && this.latest !== this.saved) {
        const text = this.latest;
        this.emit("saving");
        let res: SaveResult;
        try {
          res = await this.opts.save(text);
        } catch (e) {
          res = {
            ok: false,
            error: e instanceof Error ? e.message : String(e),
          };
        }
        if (res.ok) {
          this.saved = text;
          this.savedAt = now();
          this.failures = 0;
          if (this.latest === this.saved) {
            this.opts.onLocal?.(null);
            this.emit("saved");
          }
        } else {
          this.failures++;
          const fatal = (this.opts.isFatal ?? ((m) => DEFAULT_FATAL.test(m)))(
            res.error,
          );
          this.emit("offline", res.error, fatal);
          if (!fatal) this.scheduleRetry();
          break;
        }
      }
    })().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private scheduleRetry() {
    const steps = this.opts.backoffMs ?? DEFAULT_BACKOFF;
    const delay = steps[Math.min(this.failures - 1, steps.length - 1)];
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.drain();
    }, delay);
  }
}
