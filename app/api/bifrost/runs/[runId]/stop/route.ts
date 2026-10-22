import { gate, reply } from "@/lib/bifrost/guard";
import { getRun, stopRun } from "@/lib/bifrost/runs";

export async function POST(_req: Request, ctx: { params: Promise<{ runId: string }> }) {
  const g = await gate();
  if (!g.ok) return g.res;
  const { runId } = await ctx.params;
  const rec = getRun(runId);
  if (!rec || rec.ownerId !== g.uid) return reply({ error: "Run not found" }, 404);
  stopRun(rec);
  return reply({ ok: true }, 202);
}
