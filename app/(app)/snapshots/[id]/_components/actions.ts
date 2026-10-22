"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { readSnapshotCode } from "@/lib/storage";
import type { ActionResult } from "@/app/actions/lifecycle";

export interface CompareCode {
  id: string;
  number: number;
  state: string;
  sha: string | null;
  code: string;
  verified: boolean | null;
}

/** Code of any snapshot (used as the "other side" of a diff). Requires a signed-in user; reads go through RLS. */
export async function loadSnapshotCode(snapshotId: string): Promise<ActionResult<CompareCode>> {
  try {
    await getCurrentUser();
    if (!/^[0-9a-f-]{36}$/i.test(snapshotId)) throw new Error("Invalid snapshot id");
    const supabase = await createClient();
    const { data: s, error } = await supabase
      .from("snapshots")
      .select("id, number, state, draft_path, code_path, code_sha256")
      .eq("id", snapshotId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!s) throw new Error("Snapshot not found");
    const { code, verified } = await readSnapshotCode(s);
    return { ok: true, data: { id: s.id, number: s.number, state: s.state, sha: s.code_sha256, code, verified } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
