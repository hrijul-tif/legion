import { injectFailures } from "@/lib/bifrost/client";
import { fail, gate, reply, SIM_ID } from "@/lib/bifrost/guard";
import type { FailureCommand } from "@/lib/bifrost/types";

const TYPES = new Set(["messageOverride", "clearMessageOverride", "clearAllMessageOverrides"]);

/** Body: `{ failures: FailureCommand | FailureCommand[] }` (see docs/API.md 2.6 of the bifrost repo). */
export async function POST(req: Request, ctx: { params: Promise<{ simId: string }> }) {
  const g = await gate();
  if (!g.ok) return g.res;
  const { simId } = await ctx.params;
  if (!SIM_ID.test(simId)) return reply({ error: "Invalid simulation id" }, 400);
  const body = (await req.json().catch(() => null)) as { failures?: FailureCommand | FailureCommand[] } | null;
  const list = body?.failures ? (Array.isArray(body.failures) ? body.failures : [body.failures]) : [];
  if (!list.length || list.length > 10 || list.some((f) => !f || typeof f !== "object" || !TYPES.has(f.type))) {
    return reply({ error: "Body must be { failures: <command | command[]> } with type messageOverride | clearMessageOverride | clearAllMessageOverrides" }, 400);
  }
  try {
    return reply(await injectFailures(simId, body!.failures!), 200);
  } catch (e) {
    return fail(e);
  }
}
