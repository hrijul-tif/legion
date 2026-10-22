import { getSim } from "@/lib/bifrost/client";
import { fail, gate, reply, SIM_ID } from "@/lib/bifrost/guard";

export async function GET(_req: Request, ctx: { params: Promise<{ simId: string }> }) {
  const g = await gate();
  if (!g.ok) return g.res;
  const { simId } = await ctx.params;
  if (!SIM_ID.test(simId)) return reply({ error: "Invalid simulation id" }, 400);
  try {
    return reply(await getSim(simId), 200);
  } catch (e) {
    return fail(e);
  }
}
