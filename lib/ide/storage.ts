/** Safe localStorage helpers: every access can throw (private windows, blocked storage, quota). */

export const IDE_KEYS = {
  draft: (snapshotId: string) => `mos:draft:${snapshotId}`,
  args: (snapshotId: string) => `mos:args:${snapshotId}`,
  pinned: (snapshotId: string) => `mos:pinned:${snapshotId}`,
  lastRun: (snapshotId: string) => `mos:lastrun:${snapshotId}`,
  layout: (name: string) => `mos:ide:layout:${name}`,
  prefs: "mos:ide:prefs",
} as const;

export function readJson<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function writeJson(key: string, value: unknown): boolean {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function removeKey(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export interface LocalDraft {
  code: string;
  at: number;
}

export interface IdePrefs {
  warp?: number | "inf";
  hideCsv?: boolean;
  leftTab?: string;
  consoleTab?: string;
  sideBySide?: boolean;
  hideUnchanged?: boolean;
}

/** Debounced mirror of the unsaved buffer in localStorage (`null` clears it). */
export class LocalMirror {
  private timer: ReturnType<typeof setTimeout> | null = null;
  constructor(
    private readonly snapshotId: string,
    private readonly delayMs = 250,
  ) {}

  write(code: string | null): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (code === null) {
      removeKey(IDE_KEYS.draft(this.snapshotId));
      return;
    }
    this.timer = setTimeout(
      () =>
        writeJson(IDE_KEYS.draft(this.snapshotId), {
          code,
          at: Date.now(),
        } satisfies LocalDraft),
      this.delayMs,
    );
  }
}
