import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Profile, ProcedureEventRow, ProcedureOverview, SnapshotListRow, TransitionRow } from "@/lib/data/types";
import { PAGE_SIZE, type ProcedureSort, type StatusFilter } from "@/components/mos/procedure/search-params";

export { computeProdHistory, prodAt } from "@/lib/data/prod-history";
export type { ProdHistory, ProdSegment, RetiredWindow } from "@/lib/data/prod-history";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ProcedureFilters {
  q: string;
  mission: "FF" | "JTYU" | null;
  area: string | null;
  status: StatusFilter[];
  sort: ProcedureSort;
  page: number;
}

/** PostgREST `or(...)` filters are comma/paren delimited; keep user text from breaking out. */
function sanitize(text: string): string {
  return text.replace(/[,()*%\\"']/g, " ").trim();
}

export async function getProfiles(): Promise<Record<string, Profile>> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("profiles").select("id, email, display_name, initials, color, title, roles");
  if (error) throw new Error(error.message);
  return Object.fromEntries((data as Profile[]).map((p) => [p.id, p]));
}

const OVERVIEW_COLUMNS =
  "id, name, description, mission, folder, created_by, created_at, retired_at, retired_reason, snapshot_seq, active_snapshot_id, active_number, active_sha256, active_since, working_copies, in_review, in_test, awaiting_approval, total_snapshots, last_activity_at";

export async function listProcedures(f: ProcedureFilters): Promise<{ rows: ProcedureOverview[]; count: number }> {
  const supabase = await createClient();
  let query = supabase.from("procedure_overview").select(OVERVIEW_COLUMNS, { count: "exact" });

  const q = sanitize(f.q);
  if (q) query = query.or(`name.ilike.%${q}%,folder.ilike.%${q}%,description.ilike.%${q}%`);
  if (f.mission) query = query.eq("mission", f.mission);
  if (f.area) {
    const area = sanitize(f.area);
    query = query.or(`folder.eq.${area},folder.like.${area}/%`);
  }

  const wantRetired = f.status.includes("retired");
  query = wantRetired ? query.not("retired_at", "is", null) : query.is("retired_at", null);
  if (f.status.includes("active")) query = query.not("active_snapshot_id", "is", null);
  if (f.status.includes("none")) query = query.is("active_snapshot_id", null);
  if (f.status.includes("pending")) query = query.or("in_review.gt.0,in_test.gt.0,awaiting_approval.gt.0");
  if (f.status.includes("working")) query = query.gt("working_copies", 0);

  if (f.sort === "name") query = query.order("name", { ascending: true });
  else if (f.sort === "active") query = query.order("active_since", { ascending: false, nullsFirst: false }).order("last_activity_at", { ascending: false });
  else query = query.order("last_activity_at", { ascending: false });

  const from = (Math.max(1, f.page) - 1) * PAGE_SIZE;
  const { data, error, count } = await query.range(from, from + PAGE_SIZE - 1);
  if (error) throw new Error(error.message);
  return { rows: (data ?? []) as unknown as ProcedureOverview[], count: count ?? 0 };
}

export interface ProcedureStats {
  total: number;
  activeInProd: number;
  pending: number;
  retired: number;
}

export async function getProcedureStats(): Promise<ProcedureStats> {
  const supabase = await createClient();
  const head = () => supabase.from("procedure_overview").select("id", { count: "exact", head: true });
  const [total, active, pending, retired] = await Promise.all([
    head().is("retired_at", null),
    head().is("retired_at", null).not("active_snapshot_id", "is", null),
    head().is("retired_at", null).or("in_review.gt.0,in_test.gt.0,awaiting_approval.gt.0"),
    head().not("retired_at", "is", null),
  ]);
  for (const r of [total, active, pending, retired]) if (r.error) throw new Error(r.error.message);
  return { total: total.count ?? 0, activeInProd: active.count ?? 0, pending: pending.count ?? 0, retired: retired.count ?? 0 };
}

/** Every folder path prefix in use ("EPS", "EPS/FCP", ...) for the filter and the create dialog suggestions. */
export async function listFolders(): Promise<string[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("procedure_overview").select("folder");
  if (error) throw new Error(error.message);
  const out = new Set<string>();
  for (const { folder } of data as { folder: string }[]) {
    const parts = folder.split("/").filter(Boolean);
    for (let i = 1; i <= parts.length; i++) out.add(parts.slice(0, i).join("/"));
  }
  return [...out].sort();
}

export interface ProcedureBundle {
  procedure: ProcedureOverview;
  snapshots: SnapshotListRow[];
  transitions: TransitionRow[];
  events: ProcedureEventRow[];
  profiles: Record<string, Profile>;
  /** Server clock at fetch time; passed to client components so SSR and hydration agree. */
  nowMs: number;
}

export async function getProcedureBundle(id: string): Promise<ProcedureBundle | null> {
  if (!UUID.test(id)) return null;
  const supabase = await createClient();
  const [proc, snaps, trans, evs, profiles] = await Promise.all([
    supabase.from("procedure_overview").select(OVERVIEW_COLUMNS).eq("id", id).maybeSingle(),
    supabase.from("snapshot_list").select("*").eq("procedure_id", id).order("number", { ascending: false }),
    supabase.from("state_transitions").select("*").eq("procedure_id", id).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(1000),
    supabase.from("procedure_events").select("*").eq("procedure_id", id).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(500),
    getProfiles(),
  ]);
  for (const r of [proc, snaps, trans, evs]) if (r.error) throw new Error(r.error.message);
  if (!proc.data) return null;
  return {
    procedure: proc.data as unknown as ProcedureOverview,
    snapshots: (snaps.data ?? []) as unknown as SnapshotListRow[],
    transitions: (trans.data ?? []) as unknown as TransitionRow[],
    events: (evs.data ?? []) as unknown as ProcedureEventRow[],
    profiles,
    nowMs: Date.now(),
  };
}
