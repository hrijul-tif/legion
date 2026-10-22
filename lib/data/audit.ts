import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ACTION_VERBS, type SnapshotAction, type SnapshotState } from "@/lib/lifecycle";
import type { Profile } from "./types";
import { PRODUCTION_KINDS } from "@/components/mos/tables/audit-params";

export type Supabase = SupabaseClient;

// ---------------------------------------------------------------------------------------------
// Shared lookups (profiles, procedure names, snapshot numbers). The tables involved are small,
// so these are batched per request instead of relying on PostgREST embeds.

export type PersonLite = Pick<Profile, "id" | "display_name" | "initials" | "color" | "email" | "title" | "roles">;

export async function fetchProfiles(supabase: Supabase): Promise<Map<string, PersonLite>> {
  const { data, error } = await supabase.from("profiles").select("id, email, display_name, initials, color, title, roles").order("display_name");
  if (error) throw error;
  return new Map((data as PersonLite[]).map((p) => [p.id, p]));
}

export interface ProcedureLite {
  id: string;
  name: string;
  folder: string;
  mission: "FF" | "JTYU";
  retired_at: string | null;
}

export async function fetchProcedures(supabase: Supabase): Promise<Map<string, ProcedureLite>> {
  const { data, error } = await supabase.from("procedures").select("id, name, folder, mission, retired_at").order("name");
  if (error) throw error;
  return new Map((data as ProcedureLite[]).map((p) => [p.id, p]));
}

export interface SnapshotRef {
  id: string;
  procedure_id: string;
  number: number;
  code_sha256: string | null;
}

export async function fetchSnapshotRefs(supabase: Supabase, ids: Iterable<string>): Promise<Map<string, SnapshotRef>> {
  const unique = [...new Set(ids)];
  const out = new Map<string, SnapshotRef>();
  const chunks: string[][] = [];
  for (let i = 0; i < unique.length; i += 80) chunks.push(unique.slice(i, i + 80));
  const results = await Promise.all(
    chunks.map(async (chunk) => {
      const { data, error } = await supabase.from("snapshots").select("id, procedure_id, number, code_sha256").in("id", chunk);
      if (error) throw error;
      return data as SnapshotRef[];
    }),
  );
  for (const rows of results) for (const r of rows) out.set(r.id, r);
  return out;
}

export function personOf(profiles: Map<string, PersonLite>, id: string | null | undefined) {
  const p = id ? profiles.get(id) : undefined;
  return { id: id ?? "", displayName: p?.display_name ?? "Unknown", initials: p?.initials ?? "?", color: p?.color ?? null, email: p?.email ?? "" };
}
export type PersonView = ReturnType<typeof personOf>;

// ---------------------------------------------------------------------------------------------
// Audit stream

export interface AuditFilters {
  proc: string[];
  actor: string[];
  kind: string[];
  from: string | null;
  to: string | null;
  prod: boolean;
}

export interface AuditEntry {
  key: string;
  source: "transition" | "event";
  at: string;
  actor: PersonView;
  action: string;
  verb: string;
  procedureId: string;
  procedureName: string;
  snapshotId: string | null;
  snapshotNumber: number | null;
  snapshotSha: string | null;
  from: SnapshotState | null;
  to: SnapshotState | null;
  comment: string | null;
  relatedSnapshotId: string | null;
  relatedNumber: number | null;
  /** Human summary of the related snapshot, e.g. "Rolled back #9 → #7". */
  relation: string | null;
  production: boolean;
}

interface RawTransition {
  id: number;
  snapshot_id: string;
  procedure_id: string;
  action: SnapshotAction;
  from_state: SnapshotState | null;
  to_state: SnapshotState;
  actor_id: string;
  comment: string | null;
  related_snapshot_id: string | null;
  created_at: string;
}

interface RawEvent {
  id: number;
  procedure_id: string;
  kind: "created" | "retired" | "restored" | "working_copy_discarded";
  actor_id: string;
  reason: string | null;
  detail: Record<string, unknown> | null;
  created_at: string;
}

const TRANSITION_ACTIONS = ["create", "submit", "review_pass", "review_fail", "test_pass", "test_fail", "retest", "approve", "refuse", "send_back", "supersede", "reactivate", "withdraw"];
const EVENT_KINDS = ["created", "retired", "restored", "working_copy_discarded"];

const EVENT_VERBS: Record<string, string> = {
  created: "created the procedure",
  retired: "retired the procedure",
  restored: "restored the procedure",
  working_copy_discarded: "discarded a working copy",
};

/** Which action / event values the filters admit; an empty list means "skip that table". */
function resolveKinds(f: AuditFilters) {
  let actions = TRANSITION_ACTIONS;
  let events = EVENT_KINDS;
  if (f.kind.length) {
    actions = actions.filter((a) => f.kind.includes(a));
    events = events.filter((a) => f.kind.includes(a));
  }
  if (f.prod) {
    actions = actions.filter((a) => PRODUCTION_KINDS.includes(a));
    events = events.filter((a) => PRODUCTION_KINDS.includes(a));
  }
  return { actions, events };
}

function dayStart(d: string) {
  return `${d}T00:00:00.000Z`;
}
function dayEnd(d: string) {
  return `${d}T23:59:59.999Z`;
}
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Fetch the newest `limit` rows of each source (from `offset`), plus exact counts. */
async function fetchRaw(supabase: Supabase, f: AuditFilters, from: number, to: number) {
  const { actions, events } = resolveKinds(f);
  const apply = <Q extends { in: (c: string, v: string[]) => Q; gte: (c: string, v: string) => Q; lte: (c: string, v: string) => Q }>(q: Q): Q => {
    if (f.proc.length) q = q.in("procedure_id", f.proc);
    if (f.actor.length) q = q.in("actor_id", f.actor);
    if (f.from && DATE_RE.test(f.from)) q = q.gte("created_at", dayStart(f.from));
    if (f.to && DATE_RE.test(f.to)) q = q.lte("created_at", dayEnd(f.to));
    return q;
  };

  const tPromise =
    actions.length === 0
      ? Promise.resolve({ rows: [] as RawTransition[], count: 0 })
      : (async () => {
          let q = supabase
            .from("state_transitions")
            .select("id, snapshot_id, procedure_id, action, from_state, to_state, actor_id, comment, related_snapshot_id, created_at", { count: "exact" })
            .in("action", actions);
          q = apply(q);
          const { data, count, error } = await q.order("created_at", { ascending: false }).order("id", { ascending: false }).range(from, to);
          if (error) throw error;
          return { rows: (data ?? []) as unknown as RawTransition[], count: count ?? 0 };
        })();

  const ePromise =
    events.length === 0
      ? Promise.resolve({ rows: [] as RawEvent[], count: 0 })
      : (async () => {
          let q = supabase.from("procedure_events").select("id, procedure_id, kind, actor_id, reason, detail, created_at", { count: "exact" }).in("kind", events);
          q = apply(q);
          const { data, count, error } = await q.order("created_at", { ascending: false }).order("id", { ascending: false }).range(from, to);
          if (error) throw error;
          return { rows: (data ?? []) as unknown as RawEvent[], count: count ?? 0 };
        })();

  const [t, e] = await Promise.all([tPromise, ePromise]);
  return { transitions: t.rows, events: e.rows, total: t.count + e.count };
}

type Sortable = { at: string; source: "transition" | "event"; id: number };
function compare(a: Sortable, b: Sortable) {
  if (a.at !== b.at) return a.at < b.at ? 1 : -1;
  if (a.source !== b.source) return a.source === "transition" ? -1 : 1;
  return b.id - a.id;
}

async function enrich(supabase: Supabase, transitions: RawTransition[], events: RawEvent[]): Promise<AuditEntry[]> {
  const snapIds = new Set<string>();
  for (const t of transitions) {
    snapIds.add(t.snapshot_id);
    if (t.related_snapshot_id) snapIds.add(t.related_snapshot_id);
  }
  const [profiles, procedures, snaps] = await Promise.all([fetchProfiles(supabase), fetchProcedures(supabase), fetchSnapshotRefs(supabase, snapIds)]);
  const procName = (id: string) => procedures.get(id)?.name ?? "Deleted procedure";

  const out: (AuditEntry & { _id: number })[] = [];
  for (const t of transitions) {
    const snap = snaps.get(t.snapshot_id);
    const rel = t.related_snapshot_id ? snaps.get(t.related_snapshot_id) : undefined;
    let relation: string | null = null;
    if (rel && snap) {
      if (t.action === "reactivate") relation = `Rolled back #${rel.number} → #${snap.number}`;
      else if (t.action === "supersede") relation = `Superseded by #${rel.number}`;
      else if (t.action === "approve") relation = `Replaced #${rel.number}`;
      else if (t.action === "create") relation = `Forked from #${rel.number}`;
      else relation = `Related #${rel.number}`;
    }
    out.push({
      _id: t.id,
      key: `t-${t.id}`,
      source: "transition",
      at: t.created_at,
      actor: personOf(profiles, t.actor_id),
      action: t.action,
      verb: ACTION_VERBS[t.action] ?? t.action,
      procedureId: t.procedure_id,
      procedureName: procName(t.procedure_id),
      snapshotId: t.snapshot_id,
      snapshotNumber: snap?.number ?? null,
      snapshotSha: snap?.code_sha256 ?? null,
      from: t.from_state,
      to: t.to_state,
      comment: t.comment,
      relatedSnapshotId: t.related_snapshot_id,
      relatedNumber: rel?.number ?? null,
      relation,
      production: PRODUCTION_KINDS.includes(t.action),
    });
  }
  for (const e of events) {
    const num = typeof e.detail?.number === "number" ? (e.detail.number as number) : null;
    out.push({
      _id: e.id,
      key: `e-${e.id}`,
      source: "event",
      at: e.created_at,
      actor: personOf(profiles, e.actor_id),
      action: e.kind,
      verb: e.kind === "working_copy_discarded" && num ? `discarded working copy #${num}` : (EVENT_VERBS[e.kind] ?? e.kind),
      procedureId: e.procedure_id,
      procedureName: procName(e.procedure_id),
      snapshotId: null,
      snapshotNumber: num,
      snapshotSha: null,
      from: null,
      to: null,
      comment: e.reason,
      relatedSnapshotId: null,
      relatedNumber: null,
      relation: null,
      production: PRODUCTION_KINDS.includes(e.kind),
    });
  }
  out.sort((a, b) => compare({ at: a.at, source: a.source, id: a._id }, { at: b.at, source: b.source, id: b._id }));
  return out.map(({ _id, ...rest }) => (void _id, rest));
}

const MAX_MERGE_DEPTH = 3000;

/** One page of the merged transitions + procedure-events stream, newest first. */
export async function fetchAuditPage(supabase: Supabase, f: AuditFilters, page: number, size: number) {
  const maxPage = Math.max(1, Math.floor(MAX_MERGE_DEPTH / size));
  const p = Math.min(Math.max(1, page), maxPage);
  const need = p * size;
  const raw = await fetchRaw(supabase, f, 0, need - 1);
  // Each source is already sorted; the merged top `need` rows lie within each source's top `need`.
  const merged = [
    ...raw.transitions.map((t) => ({ at: t.created_at, source: "transition" as const, id: t.id, t })),
    ...raw.events.map((e) => ({ at: e.created_at, source: "event" as const, id: e.id, e })),
  ]
    .sort(compare)
    .slice((p - 1) * size, p * size);
  const entries = await enrich(
    supabase,
    merged.flatMap((m) => ("t" in m ? [m.t] : [])),
    merged.flatMap((m) => ("e" in m ? [m.e] : [])),
  );
  return { entries, total: raw.total, page: p, maxPage };
}

/** Everything matching the filters (capped), for CSV export. */
export async function fetchAuditAll(supabase: Supabase, f: AuditFilters, cap = 10_000): Promise<{ entries: AuditEntry[]; truncated: boolean }> {
  const batch = 1000;
  const transitions: RawTransition[] = [];
  const events: RawEvent[] = [];
  let total = 0;
  for (let from = 0; from < cap; from += batch) {
    const raw = await fetchRaw(supabase, f, from, Math.min(from + batch, cap) - 1);
    transitions.push(...raw.transitions);
    events.push(...raw.events);
    total = raw.total;
    if (raw.transitions.length < batch && raw.events.length < batch) break;
  }
  const entries = await enrich(supabase, transitions, events);
  return { entries: entries.slice(0, cap), truncated: total > cap };
}

// ---------------------------------------------------------------------------------------------
// Incident lookup: which snapshot ran at time T, and who cleared it

export interface IncidentStep {
  actor: PersonView;
  at: string;
  action: string;
  comment: string | null;
}

export interface IncidentResult {
  procedureId: string;
  procedureName: string;
  at: string;
  retiredAtTime: boolean;
  /** null: nothing was approved at that moment. */
  active: null | {
    snapshotId: string;
    number: number;
    sha: string | null;
    author: PersonView;
    activatedAt: string;
    activatedBy: PersonView;
    viaRollback: boolean;
    reviewed: IncidentStep | null;
    tested: IncidentStep | null;
    approved: IncidentStep | null;
    history: IncidentStep[];
  };
  /** Approved snapshots before `at`, in case nothing was active. */
  previous: { number: number; snapshotId: string } | null;
}

export async function lookupIncident(supabase: Supabase, procedureId: string, atIso: string): Promise<IncidentResult | null> {
  const at = new Date(atIso);
  if (Number.isNaN(at.getTime())) return null;
  const atStr = at.toISOString();
  const [profiles, procedures] = await Promise.all([fetchProfiles(supabase), fetchProcedures(supabase)]);
  const proc = procedures.get(procedureId);
  if (!proc) return null;

  const [{ data: prodRows, error: e1 }, { data: evRows, error: e2 }] = await Promise.all([
    supabase
      .from("state_transitions")
      .select("id, snapshot_id, action, actor_id, comment, created_at")
      .eq("procedure_id", procedureId)
      .in("action", ["approve", "reactivate", "supersede", "withdraw"])
      .lte("created_at", atStr)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true }),
    supabase.from("procedure_events").select("kind, created_at").eq("procedure_id", procedureId).in("kind", ["retired", "restored"]).lte("created_at", atStr).order("created_at", { ascending: false }).limit(1),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;

  let activeId: string | null = null;
  let activation: { at: string; actor_id: string; action: string } | null = null;
  let lastApproved: string | null = null;
  for (const r of (prodRows ?? []) as { snapshot_id: string; action: string; actor_id: string; created_at: string }[]) {
    if (r.action === "approve" || r.action === "reactivate") {
      activeId = r.snapshot_id;
      lastApproved = r.snapshot_id;
      activation = { at: r.created_at, actor_id: r.actor_id, action: r.action };
    } else if (r.action === "supersede" && r.snapshot_id === activeId) {
      activeId = null;
      activation = null;
    }
  }

  const retiredAtTime = ((evRows ?? []) as { kind: string }[])[0]?.kind === "retired";
  const base = { procedureId, procedureName: proc.name, at: atStr, retiredAtTime };

  if (!activeId || !activation) {
    const prev = lastApproved ? (await fetchSnapshotRefs(supabase, [lastApproved])).get(lastApproved) : undefined;
    return { ...base, active: null, previous: prev ? { number: prev.number, snapshotId: prev.id } : null };
  }

  const [{ data: snapRow, error: e3 }, { data: trs, error: e4 }] = await Promise.all([
    supabase.from("snapshots").select("id, number, code_sha256, author_id").eq("id", activeId).single(),
    supabase
      .from("state_transitions")
      .select("id, action, actor_id, comment, created_at")
      .eq("snapshot_id", activeId)
      .lte("created_at", atStr)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true }),
  ]);
  if (e3) throw e3;
  if (e4) throw e4;
  const snap = snapRow as { id: string; number: number; code_sha256: string | null; author_id: string };
  const steps: IncidentStep[] = ((trs ?? []) as { action: string; actor_id: string; comment: string | null; created_at: string }[]).map((t) => ({
    actor: personOf(profiles, t.actor_id),
    at: t.created_at,
    action: t.action,
    comment: t.comment,
  }));
  const last = (action: string) => [...steps].reverse().find((s) => s.action === action) ?? null;

  return {
    ...base,
    active: {
      snapshotId: snap.id,
      number: snap.number,
      sha: snap.code_sha256,
      author: personOf(profiles, snap.author_id),
      activatedAt: activation.at,
      activatedBy: personOf(profiles, activation.actor_id),
      viaRollback: activation.action === "reactivate",
      reviewed: last("review_pass"),
      tested: last("test_pass"),
      approved: last("approve") ?? last("reactivate"),
      history: steps,
    },
    previous: null,
  };
}

// ---------------------------------------------------------------------------------------------
// CSV

function csvCell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const CSV_HEADER = ["timestamp", "actor_email", "actor_name", "procedure", "snapshot_number", "snapshot_id", "action", "from_state", "to_state", "comment", "related_snapshot_number"];

export function auditCsvRow(e: AuditEntry): string {
  return [e.at, e.actor.email, e.actor.displayName, e.procedureName, e.snapshotNumber, e.snapshotId, e.action, e.from, e.to, e.comment, e.relatedNumber].map(csvCell).join(",");
}

export function auditCsvHeader(): string {
  return CSV_HEADER.join(",");
}
