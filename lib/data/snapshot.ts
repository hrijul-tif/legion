import "server-only";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { readSnapshotCode } from "@/lib/storage";
import type { MosRole } from "@/lib/lifecycle";
import type { Mission, RunRow, ReviewComment, SnapshotRow, TestRecord, TransitionRow } from "@/lib/data/types";

/** Everything the snapshot page needs, loaded in two query waves. Storage paths never leave the server. */

export interface PersonLite {
  id: string;
  displayName: string;
  initials: string;
  color: string;
  roles: MosRole[];
}

export type SnapshotView = Omit<SnapshotRow, "draft_path" | "code_path">;

/** A snapshot of the same procedure (frozen or working copy). */
export type SiblingSnapshot = Pick<
  SnapshotRow,
  | "id"
  | "number"
  | "state"
  | "author_id"
  | "parent_snapshot_id"
  | "code_sha256"
  | "code_bytes"
  | "summary"
  | "submitted_at"
  | "superseded_by_snapshot_id"
  | "entrypoint"
  | "signature"
  | "created_at"
  | "updated_at"
>;

/** Runs are listed without their (large) event logs; those are fetched on demand from /api/runs/[id]. */
export type RunListRow = Omit<RunRow, "events">;

export interface ProcedureLite {
  id: string;
  name: string;
  description: string;
  mission: Mission;
  folder: string;
  active_snapshot_id: string | null;
  retired_at: string | null;
  retired_reason: string | null;
}

export interface SnapshotPageData {
  me: PersonLite;
  allowSelfActions: boolean;
  snapshot: SnapshotView;
  procedure: ProcedureLite;
  siblings: SiblingSnapshot[];
  transitions: TransitionRow[];
  comments: ReviewComment[];
  tests: TestRecord[];
  runs: RunListRow[];
  people: Record<string, PersonLite>;
  code: string;
  /** sha256 of the stored bytes equals the frozen hash; null for working copies. */
  verified: boolean | null;
  codeError: string | null;
}

const SNAPSHOT_COLS =
  "id, procedure_id, number, author_id, parent_snapshot_id, state, draft_path, code_path, code_sha256, code_bytes, entrypoint, signature, summary, submitted_at, superseded_by_snapshot_id, created_at, updated_at";
const SIBLING_COLS =
  "id, number, state, author_id, parent_snapshot_id, code_sha256, code_bytes, summary, submitted_at, superseded_by_snapshot_id, entrypoint, signature, created_at, updated_at";
const RUN_COLS = "id, snapshot_id, target, code_sha256, args, options, outcome, error, summary, bifrost_sim_id, started_by, started_at, ended_at";

type SnapshotWithPaths = SnapshotRow;

export async function loadSnapshotPage(id: string): Promise<SnapshotPageData> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();

  // Wave 1: the snapshot (to learn its procedure) alongside the current user.
  const [me, snapRes] = await Promise.all([
    getCurrentUser(),
    supabase.from("snapshots").select(SNAPSHOT_COLS).eq("id", id).maybeSingle(),
  ]);
  if (snapRes.error) throw new Error(snapRes.error.message);
  const full = snapRes.data as unknown as SnapshotWithPaths | null;
  if (!full) notFound();

  // Wave 2: everything else, in parallel (and the code bytes, which come from storage).
  const [procRes, sibRes, trRes, comRes, testRes, runRes, profRes, setRes, codeRes] = await Promise.all([
    supabase
      .from("procedures")
      .select("id, name, description, mission, folder, active_snapshot_id, retired_at, retired_reason")
      .eq("id", full.procedure_id)
      .single(),
    supabase.from("snapshots").select(SIBLING_COLS).eq("procedure_id", full.procedure_id).order("number", { ascending: false }),
    supabase.from("state_transitions").select("*").eq("procedure_id", full.procedure_id).order("created_at", { ascending: true }).order("id", { ascending: true }),
    supabase.from("review_comments").select("*").eq("snapshot_id", id).order("created_at", { ascending: true }),
    supabase.from("test_records").select("*").eq("snapshot_id", id).order("created_at", { ascending: true }),
    supabase.from("runs").select(RUN_COLS).eq("snapshot_id", id).order("started_at", { ascending: false }).limit(50),
    supabase.from("profiles").select("id, display_name, initials, color, roles"),
    supabase.from("app_settings").select("allow_self_actions").maybeSingle(),
    readSnapshotCode(full).then(
      (r) => ({ ...r, error: null as string | null }),
      (e: unknown) => ({ code: "", verified: null, error: e instanceof Error ? e.message : String(e) }),
    ),
  ]);

  for (const r of [procRes, sibRes, trRes, comRes, testRes, runRes, profRes]) {
    if (r.error) throw new Error(r.error.message);
  }

  const people: Record<string, PersonLite> = {};
  for (const p of profRes.data ?? []) {
    people[p.id] = { id: p.id, displayName: p.display_name, initials: p.initials, color: p.color, roles: p.roles as MosRole[] };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { draft_path: _draft, code_path: _code, ...snapshot } = full;

  return {
    me: { id: me.id, displayName: me.displayName, initials: me.initials, color: me.color, roles: me.roles },
    allowSelfActions: setRes.data?.allow_self_actions ?? false,
    snapshot,
    procedure: procRes.data as ProcedureLite,
    siblings: (sibRes.data ?? []) as SiblingSnapshot[],
    transitions: (trRes.data ?? []) as TransitionRow[],
    comments: (comRes.data ?? []) as ReviewComment[],
    tests: (testRes.data ?? []) as TestRecord[],
    runs: (runRes.data ?? []) as RunListRow[],
    people,
    code: codeRes.code,
    verified: codeRes.verified,
    codeError: codeRes.error,
  };
}
