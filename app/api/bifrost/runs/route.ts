import { randomUUID } from "node:crypto";
import { getSim } from "@/lib/bifrost/client";
import { fail, gate, reply, SIM_ID, UUID } from "@/lib/bifrost/guard";
import { activeRunOf, runnerReady, startRun } from "@/lib/bifrost/runs";
import { readSnapshotCode } from "@/lib/storage";

interface Body {
  snapshotId?: string;
  simId?: string;
  args?: Record<string, unknown>;
  entrypoint?: string | null;
  /** only honoured for the author's own in_progress working copy (the editor buffer); frozen snapshots are always read from storage */
  code?: string;
}

/** Starts a procedure on the attached Bifrost simulation. Returns { runId }; follow it on .../runs/<id>/stream. */
export async function POST(req: Request) {
  const g = await gate();
  if (!g.ok) return g.res;
  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body?.snapshotId || !UUID.test(body.snapshotId) || !body.simId || !SIM_ID.test(body.simId)) return reply({ error: "snapshotId and simId are required" }, 400);
  if (!runnerReady()) return reply({ error: "The Bifrost runner is not installed. Run `npm run bifrost:setup`." }, 503);

  // RLS-scoped: the user can only read snapshots they may see
  const { data: snap, error } = await g.supabase
    .from("snapshots")
    .select("id, procedure_id, author_id, state, draft_path, code_path, code_sha256, entrypoint")
    .eq("id", body.snapshotId)
    .maybeSingle();
  if (error) return reply({ error: error.message }, 500);
  if (!snap) return reply({ error: "Snapshot not found" }, 404);
  const { data: proc } = await g.supabase.from("procedures").select("mission").eq("id", snap.procedure_id).maybeSingle();
  if (proc?.mission !== "JTYU") return reply({ error: "Bifrost only simulates the Jatayu (JTYU) mission" }, 400);

  let code: string;
  try {
    if (snap.state === "in_progress") {
      if (snap.author_id !== g.uid) return reply({ error: "Only the author can run a working copy" }, 403);
      code = typeof body.code === "string" && body.code.trim() ? body.code : (await readSnapshotCode(snap)).code;
    } else {
      const r = await readSnapshotCode(snap);
      if (r.verified === false) return reply({ error: "The stored code does not match the snapshot's sha256; refusing to run it" }, 409);
      code = r.code;
    }
  } catch (e) {
    return fail(e);
  }
  if (!code.trim()) return reply({ error: "The procedure is empty" }, 400);
  if (code.length > 200_000) return reply({ error: "The procedure is too large" }, 413);

  if (activeRunOf(g.uid)) return reply({ error: "You already have a Bifrost run in progress" }, 409);
  try {
    const sim = await getSim(body.simId);
    if (sim.state !== "RUNNING") return reply({ error: `Simulation ${body.simId} is ${sim.state}, not RUNNING` }, 409);
    const rec = await startRun({ runId: randomUUID(), ownerId: g.uid, simId: body.simId, yamcs: sim.yamcs, code, entrypoint: body.entrypoint ?? snap.entrypoint ?? null, args: body.args ?? {} });
    return reply({ runId: rec.id }, 201);
  } catch (e) {
    return fail(e);
  }
}
