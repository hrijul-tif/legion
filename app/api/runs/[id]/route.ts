import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { findCurrentUser } from "@/lib/auth";

/** A run's full record including its event log. The snapshot page lists runs without events and fetches them here on expand. */
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/runs/[id]">) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: "Invalid run id" }, { status: 400 });
  const user = await findCurrentUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("runs")
    .select("id, snapshot_id, target, code_sha256, args, options, outcome, error, events, summary, started_by, started_at, ended_at")
    .eq("id", id)
    .maybeSingle();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!data) return Response.json({ error: "Run not found" }, { status: 404 });
  return Response.json(data, { headers: { "Cache-Control": "private, no-store" } });
}
