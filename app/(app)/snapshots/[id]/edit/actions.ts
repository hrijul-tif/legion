"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { readSnapshotCode } from "@/lib/storage";
import type { ActionResult } from "@/app/actions/lifecycle";
import type { IdeCodeRef } from "@/lib/ide/types";

/** Code of any snapshot (the other side of a diff in the editor). Reads go through RLS like everything else. */
export async function loadCompareCode(snapshotId: string): Promise<ActionResult<IdeCodeRef>> {
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
    const { code } = await readSnapshotCode(s);
    return { ok: true, data: { id: s.id, number: s.number, sha: s.code_sha256, code } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
