import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SaveQueue, type SaveResult, type SaveState } from "./save-queue";

function setup(save: (code: string) => Promise<SaveResult>, initial = "a") {
  const states: SaveState[] = [];
  const local: Array<string | null> = [];
  const q = new SaveQueue({
    save,
    initialSaved: initial,
    onState: (s) => states.push(s),
    onLocal: (c) => local.push(c),
  });
  return { q, states, local };
}

describe("SaveQueue", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("debounces edits into one save with the latest text", async () => {
    const save = vi.fn(async () => ({ ok: true }) as SaveResult);
    const { q, states } = setup(save);
    q.setCode("ab");
    await vi.advanceTimersByTimeAsync(500);
    q.setCode("abc");
    await vi.advanceTimersByTimeAsync(799);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("abc");
    expect(states.at(-1)?.status).toBe("saved");
    expect(q.dirty).toBe(false);
  });

  it("never runs two saves at once and saves the newest text afterwards", async () => {
    let release: (r: SaveResult) => void = () => undefined;
    let inflight = 0;
    let maxInflight = 0;
    const calls: string[] = [];
    const save = vi.fn((code: string) => {
      calls.push(code);
      inflight++;
      maxInflight = Math.max(maxInflight, inflight);
      return new Promise<SaveResult>((resolve) => {
        release = (r) => {
          inflight--;
          resolve(r);
        };
      });
    });
    const { q } = setup(save);
    q.setCode("b");
    await vi.advanceTimersByTimeAsync(800);
    expect(calls).toEqual(["b"]);
    q.setCode("c");
    await vi.advanceTimersByTimeAsync(800); // debounce fires while the first save is in flight
    expect(calls).toEqual(["b"]);
    release({ ok: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toEqual(["b", "c"]);
    release({ ok: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(maxInflight).toBe(1);
    expect(q.dirty).toBe(false);
  });

  it("keeps the text, reports offline and retries with backoff", async () => {
    let fail = true;
    const save = vi.fn(async (): Promise<SaveResult> =>
      fail ? { ok: false, error: "Failed to fetch" } : { ok: true },
    );
    const { q, states, local } = setup(save);
    q.setCode("x");
    await vi.advanceTimersByTimeAsync(800);
    expect(states.at(-1)?.status).toBe("offline");
    expect(q.dirty).toBe(true);
    expect(local.at(-1)).toBe("x");
    fail = false;
    await vi.advanceTimersByTimeAsync(2000);
    expect(states.at(-1)?.status).toBe("saved");
    expect(local.at(-1)).toBeNull();
  });

  it("does not retry fatal errors", async () => {
    const save = vi.fn(async (): Promise<SaveResult> => ({
      ok: false,
      error: "This snapshot is frozen — fork it to keep editing",
    }));
    const { q, states } = setup(save);
    q.setCode("x");
    await vi.advanceTimersByTimeAsync(800);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(save).toHaveBeenCalledTimes(1);
    expect(states.at(-1)?.fatal).toBe(true);
  });

  it("flush saves immediately and resolves true once the buffer is on the server", async () => {
    const save = vi.fn(async () => ({ ok: true }) as SaveResult);
    const { q } = setup(save);
    q.setCode("fresh");
    await expect(q.flush()).resolves.toBe(true);
    expect(save).toHaveBeenCalledWith("fresh");
  });

  it("flush resolves false when the save fails", async () => {
    const save = vi.fn(async (): Promise<SaveResult> => ({
      ok: false,
      error: "boom",
    }));
    const { q } = setup(save);
    q.setCode("fresh");
    await expect(q.flush()).resolves.toBe(false);
  });
});
