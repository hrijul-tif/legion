/** Tiny external store for the caret position, so only the status bar re-renders while the user moves around. */
export interface CursorPos {
  line: number;
  column: number;
}

export class CursorStore {
  private value: CursorPos = { line: 1, column: 1 };
  private listeners = new Set<() => void>();

  readonly subscribe = (cb: () => void) => {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  };
  readonly get = (): CursorPos => this.value;

  set(next: CursorPos): void {
    if (next.line === this.value.line && next.column === this.value.column)
      return;
    this.value = next;
    this.listeners.forEach((l) => l());
  }
}
