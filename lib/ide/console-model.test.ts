import { describe, expect, it } from "vitest";
import type { RunEvent } from "../sandbox/types";
import {
  buildRows,
  buildTimeline,
  compactForStorage,
  countEvents,
  errorLine,
  filterRows,
  formatDuration,
  formatVirtual,
  DEFAULT_FILTER,
} from "./console-model";

const t0 = { wall: 0 };
const cmd = (
  t: number,
  status: "issued" | "completed" | "failed",
  q = "/FF/A/B",
  args: Record<string, unknown> = {},
): RunEvent => ({
  type: "command",
  t,
  q,
  cls: "AB",
  args,
  status,
  ...t0,
});

describe("console model", () => {
  it("pairs issued and terminal command events (FIFO per q+args)", () => {
    const rows = buildRows([
      cmd(1, "issued"),
      cmd(2, "issued"),
      cmd(3, "completed"),
      cmd(4, "failed"),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0].kind === "command" && rows[0].final?.t).toBe(3);
    expect(rows[1].kind === "command" && rows[1].final?.status).toBe("failed");
  });

  it("filters csv duplicates by default and by level/text", () => {
    const events: RunEvent[] = [
      { type: "log", level: "info", msg: "hello", logger: "run", t: 0, ...t0 },
      { type: "log", level: "info", msg: "hello", logger: "csv", t: 0, ...t0 },
      { type: "log", level: "debug", msg: "noise", logger: "sim", t: 0, ...t0 },
      { type: "stdout", text: "printed", t: 1, ...t0 },
    ];
    const rows = buildRows(events);
    expect(filterRows(rows, DEFAULT_FILTER)).toHaveLength(3);
    expect(filterRows(rows, { ...DEFAULT_FILTER, showCsv: true })).toHaveLength(
      4,
    );
    expect(filterRows(rows, { ...DEFAULT_FILTER, text: "PRINT" })).toHaveLength(
      1,
    );
    expect(
      filterRows(rows, { ...DEFAULT_FILTER, levels: new Set(["error"]) }).map(
        (r) => r.kind,
      ),
    ).toEqual(["stdout"]);
  });

  it("counts events", () => {
    const c = countEvents([
      cmd(1, "issued"),
      cmd(2, "failed"),
      { type: "tm", q: "/x", cls: null, value: 1, fresh: true, t: 2, ...t0 },
      { type: "log", level: "error", msg: "x", logger: "run", t: 2, ...t0 },
    ]);
    expect(c).toMatchObject({
      commands: 1,
      commandsFailed: 1,
      tmChecks: 1,
      errors: 1,
    });
  });

  it("formats virtual time and durations", () => {
    expect(formatVirtual(12.43)).toBe("T+12.4s");
    expect(formatVirtual(252)).toBe("T+4m12s");
    expect(formatDuration(252)).toBe("4m 12s");
    expect(formatDuration(1.34)).toBe("1.3s");
    expect(formatDuration(0.2)).toBe("200 ms");
  });

  it("extracts the innermost procedure.py line of a traceback", () => {
    const tb =
      'Traceback (most recent call last):\n  File "procedure.py", line 12, in Proc\n    helper()\n  File "procedure.py", line 5, in helper\n    1/0\nZeroDivisionError: division by zero';
    expect(errorLine(tb)).toBe(5);
    expect(errorLine(undefined)).toBeNull();
  });

  it("builds a timeline with bars, dots, marks", () => {
    const tl = buildTimeline(
      [
        cmd(1, "issued"),
        cmd(3, "completed"),
        {
          type: "tm",
          q: "/x",
          cls: "X",
          value: null,
          fresh: false,
          t: 4,
          ...t0,
        },
      ],
      {
        type: "done",
        outcome: "completed",
        t: 5,
        wall: 0,
        virtualSeconds: 5,
        wallMs: 10,
      },
    );
    expect(tl.commands[0]).toMatchObject({
      start: 1,
      end: 3,
      status: "completed",
    });
    expect(tl.tm[0].ok).toBe(false);
    expect(tl.duration).toBe(5);
  });

  it("compacts big runs from the front and drops telemetry", () => {
    const events: RunEvent[] = [{ type: "telemetry", values: {}, t: 0, ...t0 }];
    for (let i = 0; i < 3000; i++)
      events.push({
        type: "log",
        level: "info",
        msg: "m" + i,
        logger: "run",
        t: i,
        ...t0,
      });
    const out = compactForStorage(events) as RunEvent[];
    expect(out.length).toBeLessThanOrEqual(2000);
    expect((out.at(-1) as { msg: string }).msg).toBe("m2999");
  });
});
