import { gate, reply } from "@/lib/bifrost/guard";
import { answerPrompt, getRun } from "@/lib/bifrost/runs";

/** Body: { id: <prompt id>, choice: <choice string or index> } */
export async function POST(req: Request, ctx: { params: Promise<{ runId: string }> }) {
  const g = await gate();
  if (!g.ok) return g.res;
  const { runId } = await ctx.params;
  const rec = getRun(runId);
  if (!rec || rec.ownerId !== g.uid) return reply({ error: "Run not found" }, 404);
  const body = (await req.json().catch(() => null)) as { id?: string; choice?: string | number } | null;
  if (!body?.id || (typeof body.choice !== "string" && typeof body.choice !== "number")) return reply({ error: "{ id, choice } required" }, 400);
  if (!answerPrompt(rec, body.id, body.choice)) return reply({ error: "No such pending prompt" }, 409);
  return reply({ ok: true }, 200);
}
