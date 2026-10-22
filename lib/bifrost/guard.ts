import "server-only";
import { createClient } from "@/lib/supabase/server";
import { BifrostError } from "./client";

export const bifrostEnabled = () => process.env.BIFROST_ENABLED === "true";

type Supabase = Awaited<ReturnType<typeof createClient>>;
export type Gate = { ok: true; supabase: Supabase; uid: string } | { ok: false; res: Response };

const json = (body: unknown, status: number) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** Every /api/bifrost handler starts here: 404 when disabled (so the feature is invisible), 401 without a session. */
export async function gate(): Promise<Gate> {
  if (!bifrostEnabled()) return { ok: false, res: json({ error: "Not found" }, 404) };
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const uid = data?.claims?.sub;
  if (!uid) return { ok: false, res: json({ error: "Not signed in" }, 401) };
  return { ok: true, supabase, uid };
}

export function fail(e: unknown): Response {
  if (e instanceof BifrostError) return json({ error: e.message }, e.status >= 400 && e.status < 600 ? (e.status === 401 ? 502 : e.status) : 502);
  return json({ error: e instanceof Error ? e.message : String(e) }, 500);
}

export const reply = json;

/** sim ids are ISO timestamps such as 2026-10-22T00:14:14Z */
export const SIM_ID = /^[0-9A-Za-z:._-]{8,64}$/;
export const UUID = /^[0-9a-f-]{36}$/i;
