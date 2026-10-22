import { getSim, listSims, startShortSim } from "@/lib/bifrost/client";
import { fail, gate, reply } from "@/lib/bifrost/guard";
import { runnerReady } from "@/lib/bifrost/runs";
import type { SimStatus } from "@/lib/bifrost/types";

/** Simulations of the configured workspace, newest first, each with its exact lifecycle state. */
export async function GET() {
  const g = await gate();
  if (!g.ok) return g.res;
  try {
    const list = (await listSims()).sort((a, b) => b.sim_id.localeCompare(a.sim_id)).slice(0, 12);
    const sims = await Promise.all(
      list.map(async (s): Promise<SimStatus & { run_name: string | null; listStatus: string }> => {
        const st = await getSim(s.sim_id);
        return { ...st, run_name: s.run_name, listStatus: s.status };
      }),
    );
    return reply({ workspace: process.env.BIFROST_WORKSPACE, runnerReady: runnerReady(), sims }, 200);
  } catch (e) {
    return fail(e);
  }
}

/** Starts ONE short Real-time Jatayu SILS run. Requires `{ confirm: true }` (the UI asks the operator first). */
export async function POST(req: Request) {
  const g = await gate();
  if (!g.ok) return g.res;
  const body = (await req.json().catch(() => ({}))) as { confirm?: boolean; minutes?: number; runName?: string };
  if (body.confirm !== true) return reply({ error: "Starting a simulation needs { confirm: true }" }, 400);
  const minutes = Math.min(Math.max(Number(body.minutes) || 30, 5), 60);
  try {
    // never run two of ours at once
    for (const s of await listSims()) {
      if (s.status !== "COMPLETED" && s.status !== "STOPPED" && s.status !== "FAILED" && s.status !== "DELETED") {
        const st = await getSim(s.sim_id);
        if (st.state === "RUNNING" || st.state === "INITIALIZING") return reply({ error: `Simulation ${s.sim_id} is already ${st.state}; attach to it instead`, simId: s.sim_id }, 409);
      }
    }
    const r = await startShortSim({ runName: (body.runName ?? "mos-prototype").slice(0, 40), simulationTimeSec: minutes * 60 });
    return reply({ simId: r.sim_time_iso }, 202);
  } catch (e) {
    return fail(e);
  }
}
