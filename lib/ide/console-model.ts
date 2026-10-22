import type {
  CommandEvent,
  DoneEvent,
  LogEvent,
  PromptEvent,
  RunEvent,
  StdoutEvent,
  TmEvent,
} from "../sandbox/types";

/** Pure helpers behind the console, timeline and outcome banner. */

export const MAX_ROWS = 1500;

export function formatVirtual(t: number): string {
  if (!Number.isFinite(t) || t < 0) t = 0;
  if (t < 60) return `T+${t.toFixed(1)}s`;
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  if (m < 60) return `T+${m}m${String(Math.floor(s)).padStart(2, "0")}s`;
  const h = Math.floor(m / 60);
  return `T+${h}h${String(m % 60).padStart(2, "0")}m`;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return "—";
  if (seconds < 1) return `${Math.round(seconds * 1000)} ms`;
  if (seconds < 60)
    return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds - m * 60);
  if (m < 60) return `${m}m ${String(s).padStart(2, "0")}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${String(m % 60).padStart(2, "0")}m`;
}

export function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "None";
  if (typeof v === "string") return v;
  if (typeof v === "number")
    return Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(8)));
  if (typeof v === "boolean") return v ? "True" : "False";
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/* ----------------------------------------------------------------- rows */

export interface CommandRow {
  kind: "command";
  key: string;
  issued: CommandEvent;
  /** terminal event (completed / failed / timeout), once it arrived */
  final: CommandEvent | null;
}
export interface LogRow {
  kind: "log";
  key: string;
  ev: LogEvent;
}
export interface TmRow {
  kind: "tm";
  key: string;
  ev: TmEvent;
}
export interface StdoutRow {
  kind: "stdout";
  key: string;
  ev: StdoutEvent;
}
export interface PromptRow {
  kind: "prompt";
  key: string;
  ev: PromptEvent;
}
export interface DoneRow {
  kind: "done";
  key: string;
  ev: DoneEvent;
}
export type ConsoleRow =
  CommandRow | LogRow | TmRow | StdoutRow | PromptRow | DoneRow;

const argKey = (e: CommandEvent) => `${e.q}\u0000${safeJson(e.args)}`;

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return "";
  }
}

/** Pairs each command's `issued` event with its terminal event so the console shows one card per command. */
export function buildRows(events: readonly RunEvent[]): ConsoleRow[] {
  const rows: ConsoleRow[] = [];
  const open = new Map<string, CommandRow[]>();
  events.forEach((ev, i) => {
    const key = `${i}`;
    switch (ev.type) {
      case "command": {
        if (ev.status === "issued") {
          const row: CommandRow = {
            kind: "command",
            key,
            issued: ev,
            final: null,
          };
          rows.push(row);
          const k = argKey(ev);
          const q = open.get(k);
          if (q) q.push(row);
          else open.set(k, [row]);
        } else {
          const q = open.get(argKey(ev));
          const row = q?.shift();
          if (row) row.final = ev;
          else rows.push({ kind: "command", key, issued: ev, final: ev });
        }
        break;
      }
      case "log":
        rows.push({ kind: "log", key, ev });
        break;
      case "tm":
        rows.push({ kind: "tm", key, ev });
        break;
      case "stdout":
        rows.push({ kind: "stdout", key, ev });
        break;
      case "prompt":
        rows.push({ kind: "prompt", key, ev });
        break;
      case "done":
        rows.push({ kind: "done", key, ev });
        break;
      default:
        break;
    }
  });
  return rows;
}

export interface ConsoleFilter {
  levels: ReadonlySet<LogEvent["level"]>;
  showCsv: boolean;
  showCommands: boolean;
  showTm: boolean;
  showOutput: boolean;
  text: string;
}

export const DEFAULT_FILTER: ConsoleFilter = {
  levels: new Set<LogEvent["level"]>(["debug", "info", "warning", "error"]),
  showCsv: false,
  showCommands: true,
  showTm: true,
  showOutput: true,
  text: "",
};

export function rowText(row: ConsoleRow): string {
  switch (row.kind) {
    case "command":
      return `${row.issued.q} ${row.issued.cls} ${safeJson(row.issued.args)} ${(row.final ?? row.issued).status} ${(row.final ?? row.issued).error ?? ""}`;
    case "log":
      return `${row.ev.msg} ${row.ev.logger ?? ""}`;
    case "tm":
      return `${row.ev.q} ${row.ev.cls ?? ""} ${formatValue(row.ev.value)}`;
    case "stdout":
      return row.ev.text;
    case "prompt":
      return `${row.ev.message} ${row.ev.choices.join(" ")}`;
    case "done":
      return `${row.ev.outcome} ${row.ev.error ?? ""}`;
  }
}

export function filterRows(rows: ConsoleRow[], f: ConsoleFilter): ConsoleRow[] {
  const needle = f.text.trim().toLowerCase();
  return rows.filter((r) => {
    switch (r.kind) {
      case "log":
        if (!f.levels.has(r.ev.level)) return false;
        if (r.ev.logger === "csv" && !f.showCsv) return false;
        break;
      case "command":
        if (!f.showCommands) return false;
        break;
      case "tm":
        if (!f.showTm) return false;
        break;
      case "stdout":
        if (!f.showOutput) return false;
        break;
      default:
        break;
    }
    return !needle || rowText(r).toLowerCase().includes(needle);
  });
}

export interface RunCounts {
  commands: number;
  commandsFailed: number;
  tmChecks: number;
  prompts: number;
  warnings: number;
  errors: number;
  logs: number;
}

export function countEvents(events: readonly RunEvent[]): RunCounts {
  const c: RunCounts = {
    commands: 0,
    commandsFailed: 0,
    tmChecks: 0,
    prompts: 0,
    warnings: 0,
    errors: 0,
    logs: 0,
  };
  for (const ev of events) {
    if (ev.type === "command") {
      if (ev.status === "issued") c.commands++;
      else if (ev.status !== "completed") c.commandsFailed++;
    } else if (ev.type === "tm") c.tmChecks++;
    else if (ev.type === "prompt") c.prompts++;
    else if (ev.type === "log") {
      if (ev.logger === "csv") continue;
      c.logs++;
      if (ev.level === "warning") c.warnings++;
      if (ev.level === "error") c.errors++;
    }
  }
  return c;
}

export function levelCounts(
  rows: ConsoleRow[],
): Record<LogEvent["level"], number> {
  const out = { debug: 0, info: 0, warning: 0, error: 0 };
  for (const r of rows) if (r.kind === "log") out[r.ev.level]++;
  return out;
}

/** What `runs.summary` stores. */
export function summarize(events: readonly RunEvent[], done: DoneEvent | null) {
  const c = countEvents(events);
  return {
    commands: c.commands,
    tmChecks: c.tmChecks,
    prompts: c.prompts,
    warnings: c.warnings,
    errors: c.errors,
    virtualSeconds: done?.virtualSeconds ?? 0,
    wallMs: done?.wallMs ?? 0,
  };
}

/**
 * Events to keep with a run: everything but the biggest-first noise (debug logs, csv duplicates) once the
 * payload would exceed `maxBytes`, always keeping the tail (the ending is what testers look at).
 */
export function compactForStorage(
  events: readonly RunEvent[],
  maxBytes = 600_000,
  maxEvents = 2000,
): unknown[] {
  const slim = events.filter((e) => e.type !== "telemetry");
  let kept: RunEvent[] =
    slim.length > maxEvents ? slim.slice(slim.length - maxEvents) : [...slim];
  const size = (list: RunEvent[]) => safeJson(list).length;
  if (size(kept) > maxBytes)
    kept = kept.filter(
      (e) => !(e.type === "log" && (e.level === "debug" || e.logger === "csv")),
    );
  while (kept.length > 50 && size(kept) > maxBytes)
    kept = kept.slice(Math.ceil(kept.length * 0.2));
  return kept;
}

/* ------------------------------------------------------------ traceback */

export interface TracebackLine {
  text: string;
  /** line in procedure.py this frame points at */
  line?: number;
}

export function parseTraceback(tb: string): TracebackLine[] {
  return tb.split("\n").map((text) => {
    const m = /File "(?:[^"]*\/)?procedure\.py", line (\d+)/.exec(text);
    return m ? { text, line: Number(m[1]) } : { text };
  });
}

/** First procedure.py line named by a traceback (the innermost frame is the last one). */
export function errorLine(tb: string | undefined): number | null {
  if (!tb) return null;
  const lines = parseTraceback(tb).filter((l) => l.line);
  return lines.length ? (lines[lines.length - 1].line ?? null) : null;
}

/* ------------------------------------------------------------- timeline */

export interface TimelineBar {
  key: string;
  start: number;
  end: number;
  label: string;
  status: CommandEvent["status"] | "pending";
}
export interface TimelineDot {
  key: string;
  t: number;
  label: string;
  ok: boolean;
}
export interface TimelineMark {
  key: string;
  t: number;
  label: string;
}
export interface TimelineModel {
  duration: number;
  commands: TimelineBar[];
  tm: TimelineDot[];
  prompts: TimelineMark[];
  logs: Array<TimelineMark & { level: LogEvent["level"] }>;
}

export function buildTimeline(
  events: readonly RunEvent[],
  done: DoneEvent | null,
): TimelineModel {
  const commands: TimelineBar[] = [];
  const tm: TimelineDot[] = [];
  const prompts: TimelineMark[] = [];
  const logs: TimelineModel["logs"] = [];
  let maxT = 0;
  for (const row of buildRows(events)) {
    switch (row.kind) {
      case "command": {
        const start = row.issued.t;
        const end = row.final?.t ?? start;
        commands.push({
          key: row.key,
          start,
          end: Math.max(end, start),
          label: `${row.issued.cls || row.issued.q}`,
          status: row.final ? row.final.status : "pending",
        });
        maxT = Math.max(maxT, end);
        break;
      }
      case "tm":
        tm.push({
          key: row.key,
          t: row.ev.t,
          label: `${row.ev.cls ?? row.ev.q} = ${formatValue(row.ev.value)}`,
          ok: row.ev.value !== null && row.ev.value !== undefined,
        });
        maxT = Math.max(maxT, row.ev.t);
        break;
      case "prompt":
        prompts.push({ key: row.key, t: row.ev.t, label: row.ev.message });
        maxT = Math.max(maxT, row.ev.t);
        break;
      case "log":
        if (row.ev.logger !== "csv")
          logs.push({
            key: row.key,
            t: row.ev.t,
            label: row.ev.msg,
            level: row.ev.level,
          });
        maxT = Math.max(maxT, row.ev.t);
        break;
      default:
        break;
    }
  }
  return {
    duration: Math.max(done?.virtualSeconds ?? 0, maxT, 1),
    commands,
    tm,
    prompts,
    logs,
  };
}
