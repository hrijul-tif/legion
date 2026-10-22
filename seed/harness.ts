/**
 * Headless Pyodide harness shared by scripts/test-seeds.ts and scripts/seed.ts.
 * Runs MOS procedures against the mock spacecraft in Node (same Python as the browser run worker) so that
 * seeded runs, signatures and lint results are the real thing, not hand-written fixtures.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadPyodide } from "pyodide";
import { buildPyManifest } from "../scripts/py-manifest";
import type { ProcedureSignature } from "../lib/data/types";
import type { Fault, RunEvent } from "../lib/sandbox/types";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

export const STOP_ANSWER = "5: Stop execution";

export interface HarnessRunOptions {
  entrypoint?: string;
  args?: Record<string, unknown>;
  faults?: Fault[];
  /** prompt answers in order; once exhausted every further prompt gets "5: Stop execution" so a hang shows up as a failure */
  answers?: string[];
  telemetry?: Record<string, unknown>;
  /** wall-clock ms of the run start, used to stamp events (default: now) */
  startedAtMs?: number;
  /** pretend the run was warped by this factor: event wall times and wallMs are scaled by 1/displayWarp (default 1) */
  displayWarp?: number;
}

export interface HarnessResult {
  outcome: "completed" | "skipped" | "stopped" | "choose" | "error";
  error: string | null;
  traceback: string | null;
  returnValue: string | null;
  virtualSeconds: number;
  wallMs: number;
  /** all events including the closing `done` event */
  events: RunEvent[];
  prompts: { message: string; choices: string[] }[];
}

export interface LintDiagnostic {
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
  startLine: number;
}
export interface LintResult {
  diagnostics: LintDiagnostic[];
  entry: { entrypoint: string | null; params: Record<string, unknown>[] };
}

export interface SignatureParam {
  name: string;
  annotation: string;
  kind: ProcedureSignature["params"][number]["kind"];
  required: boolean;
  optional: boolean;
  enum?: string;
  members?: { name: string; value: string | number }[];
  default?: unknown;
  defaultExpr?: string;
}
export interface Signature {
  entrypoint: string;
  params: SignatureParam[];
}

export interface Harness {
  run(code: string, o?: HarnessRunOptions): HarnessResult;
  lint(code: string): LintResult;
  signature(code: string): Signature;
}

interface Bridge {
  emit(json: string): void;
  sleep(): boolean;
  prompt(json: string): number;
  read_mailbox(): string;
  interrupted(): boolean;
}

export async function createHarness(): Promise<Harness> {
  const manifest = buildPyManifest();
  const pyodide = await loadPyodide();

  let events: RunEvent[] = [];
  let prompts: { message: string; choices: string[] }[] = [];
  let answers: string[] = [];
  const bridge: Bridge = {
    emit(json) {
      const v = JSON.parse(json);
      if (Array.isArray(v)) events.push(...v);
      else events.push(v);
    },
    sleep: () => false,
    prompt(json) {
      const ev = JSON.parse(json) as RunEvent & { type: "prompt"; choices: string[]; message: string };
      events.push(ev);
      prompts.push({ message: ev.message, choices: ev.choices });
      const wanted = answers.shift() ?? STOP_ANSWER;
      const i = ev.choices.indexOf(wanted);
      return i < 0 ? ev.choices.findIndex((c) => c.startsWith("5")) : i;
    },
    read_mailbox: () => "",
    interrupted: () => false,
  };
  pyodide.registerJsModule("mos_bridge", bridge);

  const base = "/home/pyodide/mos";
  for (const f of manifest.files) {
    pyodide.FS.mkdirTree(dirname(`${base}/${f}`));
    pyodide.FS.writeFile(`${base}/${f}`, read(`public/py/${f}`));
  }
  const catalogPath = existsSync(join(ROOT, "public/catalog/ff.json")) ? "public/catalog/ff.json" : "public/catalog/__fixture.json";
  pyodide.FS.mkdirTree("/catalog");
  pyodide.FS.writeFile("/catalog/ff.json", read(catalogPath));
  pyodide.FS.mkdirTree("/sim");
  pyodide.FS.writeFile("/sim/ff-sim.json", read("public/sim/ff-sim.json"));
  pyodide.runPython(`import sys\nsys.path.insert(0, ${JSON.stringify(base)})`);

  const runner = pyodide.pyimport("mos_sim.runner");
  const info = pyodide.pyimport("mos_sim.procedure_info");
  const lintMod = pyodide.pyimport("mos_lint");

  return {
    run(code, o = {}) {
      events = [];
      prompts = [];
      answers = [...(o.answers ?? [])];
      const req = {
        code,
        entrypoint: o.entrypoint,
        args: o.args ?? {},
        mission: "FF",
        options: { warp: "inf", faults: o.faults ?? [], telemetry: o.telemetry },
      };
      const res = JSON.parse(runner.run(JSON.stringify(req)) as string) as {
        outcome: HarnessResult["outcome"];
        error: string | null;
        traceback: string | null;
        returnValue: string | null;
        virtualSeconds: number;
        wallMs: number;
      };
      const t0 = o.startedAtMs;
      const scale = 1 / (o.displayWarp ?? 1);
      const stamped: RunEvent[] = events.map((e) => (t0 === undefined ? e : { ...e, wall: t0 + Math.round(e.t * 1000 * scale) }));
      const wallMs = o.displayWarp ? Math.round(res.virtualSeconds * 1000 * scale) : res.wallMs;
      const done: RunEvent = {
        type: "done",
        t: res.virtualSeconds,
        wall: (t0 ?? Date.now()) + Math.round(res.virtualSeconds * 1000 * scale),
        outcome: res.outcome,
        ...(res.error ? { error: res.error } : {}),
        ...(res.traceback ? { traceback: res.traceback } : {}),
        ...(res.returnValue ? { returnValue: res.returnValue } : {}),
        virtualSeconds: res.virtualSeconds,
        wallMs,
      };
      return { ...res, wallMs, events: [...stamped, done], prompts: [...prompts] };
    },
    lint(code) {
      return JSON.parse(lintMod.mos_check_json(code, "FF", null) as string) as LintResult;
    },
    signature(code) {
      const sig = JSON.parse(info.inspect_json(code, "FF", null) as string) as { entrypoint: string | null; params: (Omit<SignatureParam, "annotation"> & { annotation: string | null })[]; error?: string };
      if (!sig.entrypoint) throw new Error(sig.error ?? "no entrypoint");
      // lib/data/types.ts wants `annotation: string`; an unannotated param (a lint error anyway) becomes ''
      return { entrypoint: sig.entrypoint, params: sig.params.map((p) => ({ ...p, annotation: p.annotation ?? "" })) };
    },
  };
}

/** Run summary in the shape stored in `runs.summary`. */
export function summarizeRun(events: RunEvent[]): {
  commands: number;
  tmChecks: number;
  prompts: number;
  virtualSeconds: number;
  wallMs: number;
  warnings: number;
  errors: number;
} {
  const done = events.find((e) => e.type === "done");
  return {
    commands: events.filter((e) => e.type === "command" && e.status === "issued").length,
    tmChecks: events.filter((e) => e.type === "tm").length,
    prompts: events.filter((e) => e.type === "prompt").length,
    virtualSeconds: done && done.type === "done" ? done.virtualSeconds : 0,
    wallMs: done && done.type === "done" ? done.wallMs : 0,
    warnings: events.filter((e) => e.type === "log" && e.level === "warning" && e.logger !== "sim").length,
    errors: events.filter((e) => e.type === "log" && e.level === "error" && e.logger !== "csv").length,
  };
}

/** Telemetry snapshots are large and repeat; keep the first and the last one only. */
export function compactEvents(events: RunEvent[]): RunEvent[] {
  const tmIdx = events.map((e, i) => (e.type === "telemetry" ? i : -1)).filter((i) => i >= 0);
  const keep = new Set<number>([tmIdx[0], tmIdx[tmIdx.length - 1]].filter((i) => i !== undefined));
  return events.filter((e, i) => e.type !== "telemetry" || keep.has(i));
}
