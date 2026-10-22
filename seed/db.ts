/** Database writers shared by scripts/seed.ts (and testable against any PostgREST-shaped client). */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReplayOutput } from "./types";

export type Db = SupabaseClient;

export async function must<T>(label: string, p: PromiseLike<{ data: T; error: { message: string; code?: string } | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(`${label}: ${error.message}${error.code ? ` (${error.code})` : ""}`);
  return data;
}

export async function insertChunks(db: Db, table: string, rows: Record<string, unknown>[], size = 40) {
  for (let i = 0; i < rows.length; i += size) {
    const { error } = await db.from(table).insert(rows.slice(i, i + size));
    if (error) throw new Error(`insert into ${table}: ${error.message}${error.code ? ` (${error.code})` : ""}`);
  }
}

export async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) await fn(items[i++]);
    }),
  );
}

/* --------------------------------------------------------------------------------------------- rows */
export async function writeRows(db: Db, out: ReplayOutput, uid: (email: string) => string) {
  const procs = out.procedures;
  await insertChunks(
    db,
    "procedures",
    procs.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      mission: p.mission,
      folder: p.folder,
      active_snapshot_id: null, // set once the snapshots exist (circular FK)
      snapshot_seq: p.snapshot_seq,
      retired_at: p.retired_at,
      retired_by: p.retired_by ? uid(p.retired_by) : null,
      retired_reason: p.retired_reason,
      created_by: uid(p.created_by),
      created_at: p.created_at,
    })),
  );

  await insertChunks(
    db,
    "snapshots",
    out.snapshots.map((s) => ({
      id: s.id,
      procedure_id: s.procedure_id,
      number: s.number,
      author_id: uid(s.author),
      parent_snapshot_id: s.parent_snapshot_id,
      state: s.state,
      draft_path: s.draft_path,
      code_path: s.code_path,
      code_sha256: s.code_sha256,
      code_bytes: s.code_bytes,
      entrypoint: s.entrypoint,
      signature: s.signature,
      summary: s.summary,
      submitted_at: s.submitted_at,
      superseded_by_snapshot_id: null, // forward references are set below
      created_at: s.created_at,
      updated_at: s.updated_at,
    })),
    50,
  );
  for (const s of out.snapshots.filter((x) => x.superseded_by_snapshot_id)) {
    await must(`superseded_by ${s.id}`, db.from("snapshots").update({ superseded_by_snapshot_id: s.superseded_by_snapshot_id }).eq("id", s.id).select("id"));
  }
  for (const p of procs.filter((x) => x.active_snapshot_id)) {
    await must(`active pointer ${p.name}`, db.from("procedures").update({ active_snapshot_id: p.active_snapshot_id }).eq("id", p.id).select("id"));
  }

  await insertChunks(
    db,
    "runs",
    out.runs.map((r) => ({
      id: r.id,
      snapshot_id: r.snapshot_id,
      target: r.target,
      code_sha256: r.code_sha256,
      args: r.args,
      options: r.options,
      outcome: r.outcome,
      error: r.error,
      events: r.events,
      summary: r.summary,
      started_by: uid(r.started_by),
      started_at: r.started_at,
      ended_at: r.ended_at,
    })),
    6, // events make these rows large
  );
  await insertChunks(
    db,
    "test_records",
    out.tests.map((t) => ({ id: t.id, snapshot_id: t.snapshot_id, tester_id: uid(t.tester), name: t.name, result: t.result, notes: t.notes, run_id: t.run_id, created_at: t.created_at })),
  );
  await insertChunks(
    db,
    "review_comments",
    out.comments.map((c) => ({
      id: c.id,
      snapshot_id: c.snapshot_id,
      author_id: uid(c.author),
      line: c.line,
      body: c.body,
      resolved_at: c.resolved_at,
      resolved_by: c.resolved_by ? uid(c.resolved_by) : null,
      created_at: c.created_at,
    })),
  );
  // identity ids follow insertion order, so keep the chronological order the replay produced
  await insertChunks(
    db,
    "state_transitions",
    out.transitions.map((t) => ({
      snapshot_id: t.snapshot_id,
      procedure_id: t.procedure_id,
      action: t.action,
      from_state: t.from_state,
      to_state: t.to_state,
      actor_id: uid(t.actor),
      comment: t.comment,
      related_snapshot_id: t.related_snapshot_id,
      evidence: t.evidence,
      created_at: t.created_at,
    })),
    60,
  );
  await insertChunks(
    db,
    "procedure_events",
    out.events.map((e) => ({ procedure_id: e.procedure_id, kind: e.kind, actor_id: uid(e.actor), reason: e.reason, detail: e.detail, created_at: e.created_at })),
  );
}

