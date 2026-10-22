/**
 * npx tsx scripts/bifrost-test-http.ts [base-url]   (default http://localhost:3000)
 * Exercises the real /api/bifrost routes of a running `next dev` as a demo persona: sims list, run POST, SSE stream,
 * prompt input and stop. Needs BIFROST_ENABLED=true, a RUNNING simulation and `npm run bifrost:seed`.
 */
import { createServerClient } from "@supabase/ssr";
import { createHash } from "node:crypto";
import "./bifrost-env";

const base = process.argv.find((a) => a.startsWith("http")) ?? "http://localhost:3000";
const jar = new Map<string, string>();
const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
function uid(...parts: (string | number)[]): string {
  const h = createHash("sha1").update(["mos-seed-jtyu", ...parts].join("|")).digest("hex");
  const variant = ((parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, "0");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${variant}${h.slice(18, 20)}-${h.slice(20, 32)}`;
}
const api = async (path: string, init: RequestInit = {}) => {
  const res = await fetch(base + path, { ...init, headers: { cookie: cookie(), "Content-Type": "application/json", ...(init.headers ?? {}) } });
  return res;
};

async function stream(runId: string, onEvent: (e: { type: string; [k: string]: unknown }) => Promise<void> | void) {
  const res = await api(`/api/bifrost/runs/${runId}/stream`);
  if (!res.ok || !res.body) throw new Error(`stream ${res.status}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const data = block.split("\n").find((l) => l.startsWith("data: "));
      if (!data) continue;
      const ev = JSON.parse(data.slice(6));
      await onEvent(ev);
      if (ev.type === "done") return;
    }
  }
}

async function main() {
  const sb = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: (c) => c.forEach(({ name, value }) => jar.set(name, value)) },
  });
  const { error } = await sb.auth.signInWithPassword({ email: "kabir.singh@mos.test", password: process.env.DEMO_PASSWORD! });
  if (error) throw new Error(`sign-in failed: ${error.message}`);

  const sims = (await (await api("/api/bifrost/sims")).json()) as { runnerReady: boolean; sims: { simulation_id: string; state: string }[] };
  const live = sims.sims.find((s) => s.state === "RUNNING");
  console.log(`GET /sims -> ${sims.sims.length} sims, runnerReady=${sims.runnerReady}, running: ${live?.simulation_id ?? "none"}`);
  if (!live) throw new Error("no RUNNING simulation");

  const bad = await api("/api/bifrost/runs", { method: "POST", body: JSON.stringify({ snapshotId: "not-a-uuid", simId: live.simulation_id }) });
  console.log(`POST /runs with a bad snapshot id -> ${bad.status}`);
  const mk = async (name: string, args: Record<string, unknown>, code?: string) => {
    const r = await api("/api/bifrost/runs", { method: "POST", body: JSON.stringify({ snapshotId: uid("snapshot", name, 1), simId: live.simulation_id, args, code }) });
    return { status: r.status, json: (await r.json()) as { runId?: string; error?: string } };
  };

  // 1. frozen approved snapshot; a (malicious) client `code` must be ignored
  const a = await mk("JTYU_SYS_001_Ping_and_TC_Counters", {}, "import os\nos.system('echo pwned')\ndef x():\n    pass\n");
  console.log(`POST /runs (ping, client code ignored) -> ${a.status} ${JSON.stringify(a.json)}`);
  let outcome = "";
  await stream(a.json.runId!, (e) => {
    if (e.type === "command" && e.status !== "issued") console.log(`  command ${e.cls} ${e.status}`);
    if (e.type === "done") outcome = `${e.outcome} (${e.wallMs} ms)`;
  });
  console.log(`  ping run -> ${outcome}`);

  // 2. second concurrent run is refused, prompt is answered over /input, stop works
  const b = await mk("JTYU_SYS_002_Housekeeping_Health_Check", { min_bus_voltage: 90, max_bus_voltage: 99 });
  console.log(`POST /runs (housekeeping, impossible window so it prompts) -> ${b.status}`);
  const c = await mk("JTYU_SYS_001_Ping_and_TC_Counters", {});
  console.log(`POST /runs while one is running -> ${c.status} ${c.json.error}`);
  let result = "";
  await stream(b.json.runId!, async (e) => {
    if (e.type === "prompt") {
      console.log(`  PROMPT: ${String(e.message).slice(0, 60)} -> choosing "${(e.choices as string[])[1]}"`);
      const r = await api(`/api/bifrost/runs/${b.json.runId}/input`, { method: "POST", body: JSON.stringify({ id: e.id, choice: (e.choices as string[])[1] }) });
      console.log(`  POST /input -> ${r.status}`);
    }
    if (e.type === "done") result = `${e.outcome}${e.error ? ` (${e.error})` : ""}`;
  });
  console.log(`  prompted run -> ${result}`);

  const d = await mk("JTYU_THM_003_Heater3_Control_Toggle", { target: "Off", timeout: 60 });
  let stopped = "";
  const stopTimer = setTimeout(async () => {
    const r = await api(`/api/bifrost/runs/${d.json.runId}/stop`, { method: "POST" });
    console.log(`  POST /stop -> ${r.status}`);
  }, 6000);
  await stream(d.json.runId!, (e) => {
    if (e.type === "done") stopped = `${e.outcome}${e.error ? ` (${e.error})` : ""}`;
  });
  clearTimeout(stopTimer);
  console.log(`  stopped run -> ${stopped}`);
  const other = await api(`/api/bifrost/runs/${a.json.runId}/stream`, { headers: { cookie: "" } });
  console.log(`stream without a session -> ${other.status}`);
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
