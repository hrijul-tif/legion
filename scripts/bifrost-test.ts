/**
 * npm run bifrost:test
 *
 * Live end-to-end check against the Bifrost workspace in .env.local (needs the VPN and `npm run bifrost:setup`):
 *   1. attaches to a RUNNING simulation, or starts ONE short Real-time run (stopped again at the end)
 *   2. runs every seed/procedures/jtyu/**\/*.py through the real runner (the same code path as POST /api/bifrost/runs)
 *   3. injects one fault from the override manifest during the housekeeping check and shows its effect
 *   4. stops the simulation if (and only if) this script started it
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./bifrost-env";
import { getSim, injectFailures, listSims, overrideManifest, startShortSim, stopSim } from "../lib/bifrost/client";
import { answerPrompt, runnerReady, startRun, type RunRec } from "../lib/bifrost/runs";
import type { DoneEvent, RunEvent } from "../lib/sandbox/types";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function procedures(dir = join(ROOT, "seed/procedures/jtyu")): string[] {
  return readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? procedures(join(dir, n)) : n.endsWith(".py") ? [join(dir, n)] : []));
}

const ARGS: Record<string, Record<string, unknown>> = {
  JTYU_THM_003_Heater3_Control_Toggle: { target: "Off", timeout: 60, restore: true },
};

async function waitRunning(simId: string, timeoutMs = 300_000) {
  const t0 = Date.now();
  for (;;) {
    const s = await getSim(simId);
    if (s.state === "RUNNING") return s;
    if (["FAILED", "STOPPED", "COMPLETED"].includes(s.state)) throw new Error(`simulation ${simId} is ${s.state}: ${s.error?.message ?? ""}`);
    if (Date.now() - t0 > timeoutMs) throw new Error("timed out waiting for RUNNING");
    process.stdout.write(`  ${s.state}/${s.phase ?? "-"}\r`);
    await sleep(4000);
  }
}

function follow(rec: RunRec, onEvent: (ev: RunEvent) => void): Promise<DoneEvent> {
  return new Promise((resolve) => {
    let next = 0;
    const pump = () => {
      while (next - rec.offset < rec.events.length) {
        const ev = rec.events[next++ - rec.offset];
        onEvent(ev);
        if (ev.type === "done") return resolve(ev);
      }
    };
    rec.listeners.add(pump);
    pump();
  });
}

async function runOne(file: string, simId: string, yamcs: string, opts: { onEarly?: () => Promise<void> } = {}) {
  const name = file.split("/").pop()!.replace(/\.py$/, "");
  const rec = await startRun({ runId: crypto.randomUUID(), ownerId: "test", simId, yamcs, code: readFileSync(file, "utf8"), args: ARGS[name] ?? {} });
  const counts: Record<string, number> = {};
  const lines: string[] = [];
  const t0 = Date.now();
  let early = false;
  const done = await follow(rec, (ev) => {
    counts[ev.type] = (counts[ev.type] ?? 0) + 1;
    if (ev.type === "command" && ev.status !== "issued") lines.push(`  ${ev.t.toFixed(1)}s command ${ev.cls} ${ev.status}${ev.error ? ` (${ev.error})` : ""}`);
    if (ev.type === "tm" && ev.fresh) lines.push(`  ${ev.t.toFixed(1)}s tm ${ev.q} = ${JSON.stringify(ev.value)}`);
    if (ev.type === "log" && ev.level !== "debug") lines.push(`  ${ev.t.toFixed(1)}s ${ev.level} ${ev.msg.trim().replace(/\s+/g, " ").slice(0, 150)}`);
    if (ev.type === "prompt") {
      lines.push(`  ${ev.t.toFixed(1)}s PROMPT "${ev.message.slice(0, 80)}" -> answering "${ev.choices[1] ?? ev.choices[0]}"`);
      answerPrompt(rec, ev.id, ev.choices[1] ?? ev.choices[0]);
    }
    if (!early && opts.onEarly) {
      early = true;
      void opts.onEarly().catch((e) => lines.push(`  fault injection failed: ${e}`));
    }
  });
  console.log(`\n=== ${name}\n${lines.join("\n")}\n  -> outcome ${done.outcome}${done.error ? ` (${done.error})` : ""} in ${((Date.now() - t0) / 1000).toFixed(1)} s; events ${JSON.stringify(counts)}`);
  return done;
}

async function main() {
  if (!runnerReady()) throw new Error("runner not set up: run `npm run bifrost:setup` and `npm run bifrost:gen-mdb`");
  let simId = "";
  let started = false;
  for (const s of (await listSims()).sort((a, b) => b.sim_id.localeCompare(a.sim_id))) {
    if (s.status === "COMPLETED" || s.status === "STOPPED" || s.status === "FAILED") continue;
    if ((await getSim(s.sim_id)).state === "RUNNING") {
      simId = s.sim_id;
      break;
    }
  }
  if (simId) console.log(`attaching to running simulation ${simId}`);
  else {
    simId = (await startShortSim({ runName: "mos-prototype-test", simulationTimeSec: 1800 })).sim_time_iso;
    started = true;
    console.log(`started simulation ${simId}; waiting for RUNNING`);
  }
  const results: [string, string][] = [];
  try {
    const sim = await waitRunning(simId);
    console.log(`simulation ${simId} is RUNNING (YAMCS http://${sim.yamcs})`);
    const manifest = await overrideManifest(simId);
    console.log(`override manifest: ${Object.keys(manifest.targets).length} targets, source ${manifest.source}`);
    for (const f of procedures().sort()) {
      const housekeeping = f.includes("Housekeeping");
      const done = await runOne(f, simId, sim.yamcs, {
        onEarly: housekeeping
          ? async () => {
              // EPS.output exists in the manifest; drop the reported bus voltage below the procedure's 28 V window for 150 s
              if (!manifest.targets["EPS.output"]?.fields.some((x) => x.path === "/satbus_voltage_v")) throw new Error("EPS.output /satbus_voltage_v missing from the manifest");
              const r = await injectFailures(simId, { type: "messageOverride", target: "EPS.output", mode: "replace", value: { "/satbus_voltage_v": 20.0 }, durationSec: 150 });
              console.log(`  [fault injected: EPS.output /satbus_voltage_v=20.0 for 150 s] ${JSON.stringify(r)}`);
            }
          : undefined,
      });
      results.push([f.split("/").pop()!, done.outcome]);
    }
  } finally {
    if (started) {
      await stopSim(simId).then(() => console.log(`\nstopped simulation ${simId}`), (e) => console.error("could not stop the simulation:", e));
    }
  }
  console.log("\nSUMMARY");
  for (const [n, o] of results) console.log(`  ${o.padEnd(10)} ${n}`);
  process.exit(results.every(([, o]) => o === "completed") ? 0 : 1);
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
