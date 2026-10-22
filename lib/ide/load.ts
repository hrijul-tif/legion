import "server-only";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { readSnapshotCode } from "@/lib/storage";
import type { SnapshotState } from "@/lib/lifecycle";
import type { Mission } from "@/lib/data/types";
import type {
  EditLoad,
  EditorPageData,
  IdeCodeRef,
  IdeHistoryEntry,
  IdePerson,
  IdeProcedure,
  IdeSnapshot,
  RunPageData,
} from "./types";

const UUID = /^[0-9a-f-]{36}$/i;

interface SnapRow {
  id: string;
  procedure_id: string;
  number: number;
  author_id: string;
  parent_snapshot_id: string | null;
  state: SnapshotState;
  draft_path: string;
  code_path: string | null;
  code_sha256: string | null;
  summary: string | null;
  submitted_at: string | null;
  updated_at: string;
}

const SNAP_COLS =
  "id, procedure_id, number, author_id, parent_snapshot_id, state, draft_path, code_path, code_sha256, summary, submitted_at, updated_at";

interface ProcRow {
  id: string;
  name: string;
  mission: Mission;
  folder: string;
  retired_at: string | null;
  retired_reason: string | null;
  active_snapshot_id: string | null;
}

interface ProfileRow {
  id: string;
  display_name: string;
  initials: string;
  color: string;
}

const toPerson = (p: ProfileRow | undefined, id: string): IdePerson =>
  p
    ? {
        id: p.id,
        displayName: p.display_name,
        initials: p.initials,
        color: p.color,
      }
    : { id, displayName: "Unknown", initials: "?", color: "#64748b" };

async function readCode(s: SnapRow | undefined): Promise<IdeCodeRef | null> {
  if (!s) return null;
  try {
    const { code } = await readSnapshotCode(s);
    return { id: s.id, number: s.number, sha: s.code_sha256, code };
  } catch {
    return null;
  }
}

async function loadBase(id: string) {
  if (!UUID.test(id)) notFound();
  const supabase = await createClient();
  const [me, snapRes] = await Promise.all([
    getCurrentUser(),
    supabase.from("snapshots").select(SNAP_COLS).eq("id", id).maybeSingle(),
  ]);
  if (snapRes.error) throw new Error(snapRes.error.message);
  const snap = snapRes.data as SnapRow | null;
  if (!snap) notFound();

  const [procRes, sibRes, profRes] = await Promise.all([
    supabase
      .from("procedures")
      .select(
        "id, name, mission, folder, retired_at, retired_reason, active_snapshot_id",
      )
      .eq("id", snap.procedure_id)
      .single(),
    supabase
      .from("snapshots")
      .select(SNAP_COLS)
      .eq("procedure_id", snap.procedure_id)
      .order("number", { ascending: false }),
    supabase.from("profiles").select("id, display_name, initials, color"),
  ]);
  for (const r of [procRes, sibRes, profRes])
    if (r.error) throw new Error(r.error.message);

  const proc = procRes.data as ProcRow;
  const siblings = (sibRes.data ?? []) as SnapRow[];
  const people = new Map(
    (profRes.data ?? []).map((p) => [p.id, p as ProfileRow]),
  );
  const meP: IdePerson = {
    id: me.id,
    displayName: me.displayName,
    initials: me.initials,
    color: me.color,
  };

  const procedure: IdeProcedure = {
    id: proc.id,
    name: proc.name,
    mission: proc.mission,
    folder: proc.folder,
    retiredAt: proc.retired_at,
    retiredReason: proc.retired_reason,
    activeSnapshotId: proc.active_snapshot_id,
  };
  const numberOf = new Map(siblings.map((s) => [s.id, s.number]));
  const snapshot: IdeSnapshot = {
    id: snap.id,
    number: snap.number,
    state: snap.state,
    author: toPerson(people.get(snap.author_id), snap.author_id),
    parentId: snap.parent_snapshot_id,
    parentNumber: snap.parent_snapshot_id
      ? (numberOf.get(snap.parent_snapshot_id) ?? null)
      : null,
    sha: snap.code_sha256,
    summary: snap.summary,
    updatedAt: snap.updated_at,
  };
  const history: IdeHistoryEntry[] = siblings.map((s) => ({
    id: s.id,
    number: s.number,
    state: s.state,
    author: toPerson(people.get(s.author_id), s.author_id),
    sha: s.code_sha256,
    summary: s.summary,
    submittedAt: s.submitted_at,
    updatedAt: s.updated_at,
    parentNumber: s.parent_snapshot_id
      ? (numberOf.get(s.parent_snapshot_id) ?? null)
      : null,
    isActive: s.id === proc.active_snapshot_id,
    isCurrent: s.id === snap.id,
  }));
  return { me, meP, snap, siblings, procedure, snapshot, history };
}

const bifrostEnabled = () => process.env.BIFROST_ENABLED === "true";

/** Everything the Workspace needs for /snapshots/[id]/edit (also tells whether the viewer may edit). */
export async function loadEditPage(id: string): Promise<EditLoad> {
  const b = await loadBase(id);
  const isAuthor = b.snap.author_id === b.me.id;
  const editable = isAuthor && b.snap.state === "in_progress";

  let code = "";
  let parent: IdeCodeRef | null = null;
  let active: IdeCodeRef | null = null;
  if (editable) {
    const parentRow = b.snap.parent_snapshot_id
      ? b.siblings.find((s) => s.id === b.snap.parent_snapshot_id)
      : undefined;
    const activeRow = b.procedure.activeSnapshotId
      ? b.siblings.find((s) => s.id === b.procedure.activeSnapshotId)
      : undefined;
    const [draft, p, a] = await Promise.all([
      readSnapshotCode(b.snap),
      parentRow && parentRow.state !== "in_progress"
        ? readCode(parentRow)
        : null,
      activeRow ? readCode(activeRow) : null,
    ]);
    code = draft.code;
    parent = p;
    active = a;
  }

  const data: EditorPageData = {
    me: b.meP,
    procedure: b.procedure,
    snapshot: b.snapshot,
    code,
    parent,
    active,
    history: b.history,
    bifrostEnabled: bifrostEnabled(),
  };
  if (editable) return { block: { kind: "ok" }, data };
  if (b.snap.state !== "in_progress") {
    return {
      block: {
        kind: "frozen",
        reason:
          "This snapshot is frozen. Snapshots never change once submitted — fork it to keep working.",
      },
      data,
    };
  }
  return {
    block: {
      kind: "not_author",
      reason: `This is ${b.snapshot.author.displayName}'s working copy. Only its author can edit it.`,
    },
    data,
  };
}

export async function loadRunPage(id: string): Promise<RunPageData> {
  const b = await loadBase(id);
  const ownDraft =
    b.snap.state === "in_progress" && b.snap.author_id === b.me.id;
  let code = "";
  if (!ownDraft) {
    try {
      code = (await readSnapshotCode(b.snap)).code;
    } catch {
      code = "";
    }
  }
  return {
    me: b.meP,
    procedure: b.procedure,
    snapshot: b.snapshot,
    code,
    ownDraft,
    bifrostEnabled: bifrostEnabled(),
  };
}
