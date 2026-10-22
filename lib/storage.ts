import "server-only";
import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

export const CODE_BUCKET = "procedure-code";

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function frozenPath(procedureId: string, snapshotId: string, sha: string): string {
  return `frozen/${procedureId}/${snapshotId}-${sha}.py`;
}

/** Callers must have checked permissions (via an RLS-scoped read or a lifecycle RPC) before calling these. */
export async function readObject(path: string): Promise<string> {
  const { data, error } = await createAdminClient().storage.from(CODE_BUCKET).download(path);
  if (error || !data) {
    // A brand-new working copy may not have been written yet.
    if (path.startsWith("drafts/") && /not.?found|Object not found|404/i.test(error?.message ?? "")) return "";
    throw new Error(`Could not read ${path}: ${error?.message ?? "no data"}`);
  }
  return await data.text();
}

export async function writeObject(path: string, text: string, { upsert }: { upsert: boolean }): Promise<void> {
  const { error } = await createAdminClient()
    .storage.from(CODE_BUCKET)
    .upload(path, new Blob([text], { type: "text/x-python" }), { upsert, contentType: "text/x-python", cacheControl: "no-store" });
  if (error) throw new Error(`Could not write ${path}: ${error.message}`);
}

export async function copyObject(from: string, to: string): Promise<void> {
  await writeObject(to, await readObject(from), { upsert: true });
}

/** Reads a snapshot's code. Frozen snapshots are re-hashed so the UI can prove the bytes are the submitted ones. */
export async function readSnapshotCode(s: { state: string; draft_path: string; code_path: string | null; code_sha256: string | null }): Promise<{
  code: string;
  verified: boolean | null;
}> {
  if (s.state === "in_progress" || !s.code_path) return { code: await readObject(s.draft_path), verified: null };
  const code = await readObject(s.code_path);
  return { code, verified: sha256(code) === s.code_sha256 };
}
