"use server";

import { refresh } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { copyObject, frozenPath, readObject, sha256, writeObject } from "@/lib/storage";
import { procedureTemplate } from "@/lib/procedure-template";
import type { ManualAction } from "@/lib/lifecycle";
import type { Mission, ProcedureSignature } from "@/lib/data/types";

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

function fail(e: unknown): { ok: false; error: string } {
  const msg = e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String((e as { message: unknown }).message) : String(e);
  return { ok: false, error: msg };
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export async function createProcedure(input: { name: string; description: string; mission: Mission; folder: string }): Promise<
  ActionResult<{ procedureId: string; snapshotId: string }>
> {
  try {
    await getCurrentUser();
    const res = await rpc<{ procedure_id: string; snapshot_id: string; draft_path: string }>("create_procedure", {
      p_name: input.name,
      p_description: input.description,
      p_mission: input.mission,
      p_folder: input.folder,
    });
    await writeObject(res.draft_path, procedureTemplate(input.name, input.mission), { upsert: true });
    refresh();
    return { ok: true, data: { procedureId: res.procedure_id, snapshotId: res.snapshot_id } };
  } catch (e) {
    return fail(e);
  }
}

/** Fork any snapshot (or start empty) into a new working copy for the current author. */
export async function forkSnapshot(procedureId: string, parentSnapshotId: string | null): Promise<ActionResult<{ snapshotId: string; number: number }>> {
  try {
    await getCurrentUser();
    const res = await rpc<{ snapshot_id: string; number: number; draft_path: string; parent_source_path: string | null }>("create_working_copy", {
      p_procedure_id: procedureId,
      p_parent_snapshot_id: parentSnapshotId,
    });
    if (res.parent_source_path) await copyObject(res.parent_source_path, res.draft_path);
    else await writeObject(res.draft_path, "", { upsert: true });
    refresh();
    return { ok: true, data: { snapshotId: res.snapshot_id, number: res.number } };
  } catch (e) {
    return fail(e);
  }
}

/** Autosave. Only the author's own working copy, and only while it is in progress. */
export async function saveDraft(snapshotId: string, code: string): Promise<ActionResult<{ savedAt: string; sha: string }>> {
  try {
    const user = await getCurrentUser();
    const supabase = await createClient();
    const { data: snap, error } = await supabase.from("snapshots").select("id, author_id, state, draft_path").eq("id", snapshotId).single();
    if (error || !snap) throw new Error("Snapshot not found");
    if (snap.author_id !== user.id) throw new Error("Only the author can edit this working copy");
    if (snap.state !== "in_progress") throw new Error("This snapshot is frozen — fork it to keep editing");
    if (code.length > 512_000) throw new Error("Procedure is too large (500 KB max)");
    await writeObject(snap.draft_path, code, { upsert: true });
    const savedAt = new Date().toISOString();
    await createAdminTouch(snapshotId, savedAt);
    return { ok: true, data: { savedAt, sha: sha256(code) } };
  } catch (e) {
    return fail(e);
  }
}

async function createAdminTouch(snapshotId: string, at: string) {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  await createAdminClient().from("snapshots").update({ updated_at: at }).eq("id", snapshotId).eq("state", "in_progress");
}

/** Freeze the working copy (exact bytes from storage), submit it for review, and fork a fresh working copy. */
export async function submitSnapshot(input: { snapshotId: string; summary: string; signature: ProcedureSignature; fork: boolean }): Promise<
  ActionResult<{ submittedId: string; number: number; forkId: string | null; forkNumber: number | null; sha: string }>
> {
  try {
    const user = await getCurrentUser();
    const supabase = await createClient();
    const { data: snap } = await supabase.from("snapshots").select("id, procedure_id, author_id, state, draft_path").eq("id", input.snapshotId).single();
    if (!snap) throw new Error("Snapshot not found");
    if (snap.author_id !== user.id || snap.state !== "in_progress") throw new Error("Only the author can submit an in-progress working copy");

    const code = await readObject(snap.draft_path);
    if (!code.trim()) throw new Error("The working copy is empty");
    const sha = sha256(code);
    const path = frozenPath(snap.procedure_id, snap.id, sha);
    await writeObject(path, code, { upsert: false }).catch((e: Error) => {
      if (!/exists|duplicate/i.test(e.message)) throw e;
    });

    const res = await rpc<{ submitted_id: string; number: number; fork_id: string | null; fork_number: number | null; fork_draft_path: string | null }>(
      "submit_snapshot",
      {
        p_snapshot_id: snap.id,
        p_summary: input.summary,
        p_code_path: path,
        p_sha256: sha,
        p_bytes: Buffer.byteLength(code, "utf8"),
        p_entrypoint: input.signature.entrypoint,
        p_signature: input.signature,
        p_fork: input.fork,
      },
    );
    if (res.fork_draft_path) await writeObject(res.fork_draft_path, code, { upsert: true });
    refresh();
    return { ok: true, data: { submittedId: res.submitted_id, number: res.number, forkId: res.fork_id, forkNumber: res.fork_number, sha } };
  } catch (e) {
    return fail(e);
  }
}

export async function transitionSnapshot(input: { snapshotId: string; action: ManualAction; comment?: string; evidence?: Record<string, unknown> }): Promise<
  ActionResult<{ from: string; to: string; supersededNumber: number | null }>
> {
  try {
    await getCurrentUser();
    const res = await rpc<{ from: string; to: string; superseded_number: number | null }>("transition_snapshot", {
      p_snapshot_id: input.snapshotId,
      p_action: input.action,
      p_comment: input.comment ?? null,
      p_evidence: input.evidence ?? {},
    });
    refresh();
    return { ok: true, data: { from: res.from, to: res.to, supersededNumber: res.superseded_number } };
  } catch (e) {
    return fail(e);
  }
}

export async function discardWorkingCopy(snapshotId: string): Promise<ActionResult> {
  try {
    await getCurrentUser();
    await rpc("discard_working_copy", { p_snapshot_id: snapshotId });
    refresh();
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e);
  }
}

export async function setProcedureRetired(procedureId: string, retired: boolean, reason: string): Promise<ActionResult> {
  try {
    await getCurrentUser();
    await rpc("set_procedure_retired", { p_procedure_id: procedureId, p_retired: retired, p_reason: reason });
    refresh();
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e);
  }
}
