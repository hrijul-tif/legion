"use server";

import { refresh } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import type { ActionResult } from "./lifecycle";
import type { RunRow, TestRecord } from "@/lib/data/types";
import type { MosRole } from "@/lib/lifecycle";

function fail(e: unknown): { ok: false; error: string } {
  return { ok: false, error: e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e) };
}

export async function addReviewComment(snapshotId: string, line: number | null, body: string): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await getCurrentUser();
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("review_comments")
      .insert({ snapshot_id: snapshotId, line, body: body.trim(), author_id: user.id })
      .select("id")
      .single();
    if (error) throw error;
    refresh();
    return { ok: true, data: { id: data.id } };
  } catch (e) {
    return fail(e);
  }
}

export async function setCommentResolved(commentId: string, resolved: boolean): Promise<ActionResult> {
  try {
    const user = await getCurrentUser();
    const supabase = await createClient();
    const { error } = await supabase
      .from("review_comments")
      .update(resolved ? { resolved_at: new Date().toISOString(), resolved_by: user.id } : { resolved_at: null, resolved_by: null })
      .eq("id", commentId);
    if (error) throw error;
    refresh();
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e);
  }
}

export async function addTestRecord(input: Pick<TestRecord, "snapshot_id" | "name" | "result" | "notes" | "run_id">): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await getCurrentUser();
    const supabase = await createClient();
    const { data, error } = await supabase.from("test_records").insert({ ...input, tester_id: user.id }).select("id").single();
    if (error) throw error;
    refresh();
    return { ok: true, data: { id: data.id } };
  } catch (e) {
    return fail(e);
  }
}

export async function startRun(input: Pick<RunRow, "snapshot_id" | "target" | "code_sha256" | "args" | "options">): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await getCurrentUser();
    const supabase = await createClient();
    const { data, error } = await supabase.from("runs").insert({ ...input, started_by: user.id }).select("id").single();
    if (error) throw error;
    return { ok: true, data: { id: data.id } };
  } catch (e) {
    return fail(e);
  }
}

export async function finishRun(
  runId: string,
  input: Pick<RunRow, "outcome" | "error" | "events" | "summary">,
): Promise<ActionResult> {
  try {
    await getCurrentUser();
    const supabase = await createClient();
    const { error } = await supabase
      .from("runs")
      .update({ ...input, events: (input.events ?? []).slice(-3000), ended_at: new Date().toISOString() })
      .eq("id", runId);
    if (error) throw error;
    refresh();
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e);
  }
}

export async function setUserRoles(userId: string, roles: MosRole[]): Promise<ActionResult> {
  try {
    await getCurrentUser();
    const supabase = await createClient();
    const { error } = await supabase.rpc("set_user_roles", { p_user_id: userId, p_roles: roles });
    if (error) throw error;
    refresh();
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e);
  }
}

export async function setAllowSelfActions(allow: boolean): Promise<ActionResult> {
  try {
    await getCurrentUser();
    const supabase = await createClient();
    const { error } = await supabase.rpc("set_allow_self_actions", { p_allow: allow });
    if (error) throw error;
    refresh();
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e);
  }
}
