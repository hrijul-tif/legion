/**
 * Registry of server-side procedure runs (one child process of the Python runner each). Lives on globalThis so route
 * handlers and HMR reloads share it. Events are buffered for replay so an SSE client can (re)attach at any time.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunEvent } from "../sandbox/types";

const MAX_EVENTS = 20_000;
const KEEP_AFTER_DONE_MS = 10 * 60_000;

export interface RunRec {
  id: string;
  ownerId: string;
  simId: string;
  events: RunEvent[];
  /** index of events[0] in the full stream (grows when old events are dropped) */
  offset: number;
  done: boolean;
  pendingPrompt: string | null;
  stopping: boolean;
  child: ChildProcessWithoutNullStreams | null;
  listeners: Set<() => void>;
}

const g = globalThis as unknown as { __bifrostRuns?: Map<string, RunRec> };
const registry = (g.__bifrostRuns ??= new Map());

export const getRun = (id: string) => registry.get(id);
export const activeRunOf = (ownerId: string) => [...registry.values()].find((r) => r.ownerId === ownerId && !r.done);

export function runnerRoot(): string {
  return join(process.cwd(), "runner");
}

function pythonCommand(): { cmd: string; args: string[] } {
  const venv = join(runnerRoot(), ".venv/bin/python");
  // the venv's interpreter directly: signals reach python itself (uv run would sit in between)
  if (existsSync(venv)) return { cmd: venv, args: ["-m", "mos_runner"] };
  return { cmd: "uv", args: ["run", "--no-sync", "--project", runnerRoot(), "python", "-m", "mos_runner"] };
}

export function runnerReady(): boolean {
  return existsSync(join(runnerRoot(), ".work/mos-framework/framework/mdb/super_class.py")) && existsSync(join(runnerRoot(), ".venv/bin/python"));
}

function push(rec: RunRec, ev: RunEvent) {
  rec.events.push(ev);
  if (rec.events.length > MAX_EVENTS) {
    // drop the oldest non-essential events, never `done`/`prompt`
    const drop = rec.events.length - MAX_EVENTS;
    rec.events.splice(0, drop);
    rec.offset += drop;
  }
  if (ev.type === "prompt") rec.pendingPrompt = ev.id;
  if (ev.type === "done") rec.done = true;
  for (const l of rec.listeners) l();
}

const now = (rec: RunRec) => ({ t: (Date.now() - startedAt.get(rec.id)!) / 1000, wall: Date.now() });
const startedAt = new Map<string, number>();

export interface StartArgs {
  runId: string;
  ownerId: string;
  simId: string;
  yamcs: string;
  code: string;
  entrypoint?: string | null;
  args: Record<string, unknown>;
}

export async function startRun(a: StartArgs): Promise<RunRec> {
  const dir = await mkdtemp(join(tmpdir(), "mos-bifrost-"));
  const file = join(dir, "procedure.py");
  await writeFile(file, a.code, "utf8");
  const { cmd, args } = pythonCommand();
  const child = spawn(
    cmd,
    [...args, "--code-file", file, "--yamcs-url", a.yamcs, "--instance", "jtyu", "--mission", "jtyu", ...(a.entrypoint ? ["--entry", a.entrypoint] : []), "--args-json", JSON.stringify(a.args ?? {})],
    // no secrets (Supabase keys, Bifrost token) reach the procedure process
    { cwd: runnerRoot(), stdio: ["pipe", "pipe", "pipe"], env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", LANG: "en_US.UTF-8", PYTHONUNBUFFERED: "1", NODE_ENV: "production" } },
  );
  const rec: RunRec = { id: a.runId, ownerId: a.ownerId, simId: a.simId, events: [], offset: 0, done: false, pendingPrompt: null, stopping: false, child, listeners: new Set() };
  registry.set(rec.id, rec);
  startedAt.set(rec.id, Date.now());

  let buf = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
    buf += chunk;
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      try {
        push(rec, JSON.parse(line) as RunEvent);
      } catch {
        push(rec, { type: "stdout", text: line, stream: "stderr", ...now(rec) });
      }
    }
  });
  let errBuf = "";
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
    errBuf += chunk;
    let i: number;
    while ((i = errBuf.indexOf("\n")) >= 0) {
      const line = errBuf.slice(0, i);
      errBuf = errBuf.slice(i + 1);
      if (line.trim()) push(rec, { type: "stdout", text: line, stream: "stderr", ...now(rec) });
    }
  });
  child.stdin.on("error", () => undefined);
  child.on("error", (e) => {
    if (!rec.done) push(rec, { type: "done", outcome: "error", error: `Could not start the runner: ${e.message}. Run \`npm run bifrost:setup\`.`, virtualSeconds: 0, wallMs: 0, ...now(rec) });
  });
  child.on("close", (code, signal) => {
    if (!rec.done) {
      const wall = Date.now() - startedAt.get(rec.id)!;
      push(rec, {
        type: "done",
        outcome: rec.stopping ? "stopped" : "error",
        error: rec.stopping ? "Stopped by the operator" : `The runner exited unexpectedly (${signal ?? `code ${code}`})`,
        virtualSeconds: wall / 1000,
        wallMs: wall,
        ...now(rec),
      });
    }
    rec.child = null;
    void rm(dir, { recursive: true, force: true });
    setTimeout(() => {
      registry.delete(rec.id);
      startedAt.delete(rec.id);
    }, KEEP_AFTER_DONE_MS).unref();
  });
  return rec;
}

export function answerPrompt(rec: RunRec, id: string, choice: string | number): boolean {
  if (!rec.child || rec.pendingPrompt !== id) return false;
  rec.pendingPrompt = null;
  rec.child.stdin.write(JSON.stringify({ id, choice }) + "\n");
  return true;
}

/** SIGINT (the runner turns it into KeyboardInterrupt -> outcome `stopped`), SIGKILL after 2 s. */
export function stopRun(rec: RunRec): void {
  const child = rec.child;
  if (!child || rec.done) return;
  rec.stopping = true;
  child.kill("SIGINT");
  setTimeout(() => {
    if (rec.child && !rec.done) rec.child.kill("SIGKILL");
  }, 2000).unref();
}
