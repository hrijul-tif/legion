import "server-only";
import type { SnapshotListRow } from "./types";
import type { Supabase } from "./audit";
import type { SnapshotSortKey } from "@/components/mos/tables/snapshot-params";
import type { SnapshotState } from "@/lib/lifecycle";

export interface SnapshotFilters {
  q: string;
  proc: string[];
  state: SnapshotState[];
  author: string[];
  mission: "FF" | "JTYU" | null;
  active: boolean;
  field: "changed" | "created";
  from: string | null;
  to: string | null;
  sort: SnapshotSortKey;
  dir: "asc" | "desc";
  page: number;
  size: number;
}

const COLUMNS =
  "id, procedure_id, procedure_name, mission, folder, procedure_retired_at, number, state, summary, code_sha256, entrypoint, parent_snapshot_id, parent_number, author_id, author_name, author_initials, author_color, created_at, submitted_at, updated_at, state_changed_at, is_active";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** PostgREST `or=` values: quote and strip characters that would break the filter grammar. */
function orValue(pattern: string) {
  return `"${pattern.replace(/[\\"]/g, "")}"`;
}

function buildQuery(supabase: Supabase, f: SnapshotFilters, head: boolean) {
  let q = supabase.from("snapshot_list").select(COLUMNS, { count: "exact", head });
  if (f.proc.length) q = q.in("procedure_id", f.proc);
  if (f.state.length) q = q.in("state", f.state);
  if (f.author.length) q = q.in("author_id", f.author);
  if (f.mission) q = q.eq("mission", f.mission);
  if (f.active) q = q.eq("is_active", true);
  const dateCol = f.field === "created" ? "created_at" : "state_changed_at";
  if (f.from && DATE_RE.test(f.from)) q = q.gte(dateCol, `${f.from}T00:00:00.000Z`);
  if (f.to && DATE_RE.test(f.to)) q = q.lte(dateCol, `${f.to}T23:59:59.999Z`);

  const text = f.q.trim();
  if (text) {
    const like = text.replace(/%/g, "");
    const parts = [`procedure_name.ilike.${orValue(`%${like}%`)}`, `summary.ilike.${orValue(`%${like}%`)}`];
    if (/^[0-9a-f]{3,64}$/i.test(text)) parts.push(`code_sha256.ilike.${orValue(`${text.toLowerCase()}%`)}`);
    const num = /^#?(\d{1,6})$/.exec(text);
    if (num) parts.push(`number.eq.${num[1]}`);
    q = q.or(parts.join(","));
  }
  return q;
}

export interface SnapshotPage {
  rows: SnapshotListRow[];
  total: number;
  page: number;
  pageCount: number;
}

/** Server-paginated query over the `snapshot_list` view. */
export async function querySnapshots(supabase: Supabase, f: SnapshotFilters): Promise<SnapshotPage> {
  const size = f.size;
  const page = Math.max(1, f.page);
  const asc = f.dir === "asc";
  let q = buildQuery(supabase, f, false);
  switch (f.sort) {
    case "created":
      q = q.order("created_at", { ascending: asc });
      break;
    case "name":
      q = q.order("procedure_name", { ascending: asc }).order("number", { ascending: false });
      break;
    case "number":
      q = q.order("number", { ascending: asc }).order("procedure_name", { ascending: true });
      break;
    default:
      q = q.order("state_changed_at", { ascending: asc, nullsFirst: false });
  }
  q = q.order("id", { ascending: true });

  const from = (page - 1) * size;
  const { data, count, error } = await q.range(from, from + size - 1);
  if (error) {
    // A page past the end is a 416 from PostgREST: report the real total with no rows.
    if (error.code === "PGRST103") {
      const { count: total, error: e2 } = await buildQuery(supabase, f, true);
      if (e2) throw e2;
      const t = total ?? 0;
      return { rows: [], total: t, page, pageCount: Math.max(1, Math.ceil(t / size)) };
    }
    throw error;
  }
  const total = count ?? 0;
  return { rows: (data ?? []) as unknown as SnapshotListRow[], total, page, pageCount: Math.max(1, Math.ceil(total / size)) };
}
