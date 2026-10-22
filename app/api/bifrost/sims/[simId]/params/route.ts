import { readFswParam } from "@/lib/bifrost/client";
import { fail, gate, reply, SIM_ID } from "@/lib/bifrost/guard";

/** Body: `{ parameter: "/jTYU/SYS/Sys_Mode" }` -> YAMCS's own value, via Bifrost's mcs passthrough. */
export async function POST(req: Request, ctx: { params: Promise<{ simId: string }> }) {
  const g = await gate();
  if (!g.ok) return g.res;
  const { simId } = await ctx.params;
  if (!SIM_ID.test(simId)) return reply({ error: "Invalid simulation id" }, 400);
  const body = (await req.json().catch(() => null)) as { parameter?: string } | null;
  if (!body?.parameter || !/^\/jTYU\/[\w./-]{1,200}$/.test(body.parameter)) return reply({ error: "parameter must be a /jTYU/... qualified name" }, 400);
  try {
    return reply(await readFswParam(simId, body.parameter), 200);
  } catch (e) {
    return fail(e);
  }
}
