/**
 * npm run bifrost:seed   (run after `npm run db:seed`)
 *
 * Adds the Jatayu demo procedures from seed/procedures/jtyu/ to the database: one procedure each (mission JTYU),
 * a plausible approved history for two of them and one waiting for approval, frozen code uploaded with its sha256.
 * Idempotent: procedures that already exist (deterministic ids) are skipped; nothing else is touched.
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..");
config({ path: join(ROOT, ".env.local"), quiet: true });

const BUCKET = "procedure-code";
const sha256 = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");
function uid(...parts: (string | number)[]): string {
  const h = createHash("sha1").update(["mos-seed-jtyu", ...parts].join("|")).digest("hex");
  const variant = ((parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, "0");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${variant}${h.slice(18, 20)}-${h.slice(20, 32)}`;
}
const need = (n: string) => {
  const v = process.env[n];
  if (!v) {
    console.error(`Missing ${n} in .env.local`);
    process.exit(1);
  }
  return v;
};
const ago = (days: number, hours = 0) => new Date(Date.now() - (days * 24 + hours) * 3600_000).toISOString();

interface Plan {
  file: string;
  folder: string;
  author: string;
  /** final state the history ends in */
  endState: "approved" | "approval_pending";
  summary: string;
  daysAgo: number;
  reviewComment?: string;
  testName: string;
  testNotes: string;
}

const PLANS: Plan[] = [
  {
    file: "SYS/JTYU_SYS_001_Ping_and_TC_Counters.py",
    folder: "SYS",
    author: "asha.rao@mos.test",
    endState: "approved",
    summary: "Ping the OBC and check the PUS telecommand counters",
    daysAgo: 21,
    testName: "Ping on Bifrost SILS (jtyu-v15.0.3)",
    testNotes: "Are-you-alive completed in under a second; TC counters received=accepted, rejected=0.",
  },
  {
    file: "SYS/JTYU_SYS_002_Housekeeping_Health_Check.py",
    folder: "SYS",
    author: "rohan.mehta@mos.test",
    endState: "approved",
    summary: "Range-check bus voltage, body rates and system/EPS modes from housekeeping",
    daysAgo: 14,
    reviewComment: "The range check returns a 2-tuple when the operator continues past a failed check; please handle that instead of unpacking three values.",
    testName: "Nominal run plus injected 20 V bus-voltage override",
    testNotes: "Nominal: all checks pass. With EPS.output /satbus_voltage_v overridden to 20 V the range check prompts the operator as designed.",
  },
  {
    file: "THM/JTYU_THM_003_Heater3_Control_Toggle.py",
    folder: "THM",
    author: "asha.rao@mos.test",
    endState: "approval_pending",
    summary: "Toggle heater 3 control, verify in telemetry, restore the previous state",
    daysAgo: 4,
    testName: "Off/On toggle with restore on Bifrost SILS",
    testNotes: "Htr3_Ctrl_St followed the command within one THM housekeeping period (30 s) and was restored.",
  },
];

function signatureOf(path: string) {
  const out = execFileSync("python3", [join(ROOT, "runner/mos_runner/signature.py"), path, join(ROOT, "public/catalog/jtyu.json"), join(ROOT, "public/py")], { encoding: "utf8" });
  return JSON.parse(out) as { entrypoint: string; params: unknown[]; doc: string };
}

async function main() {
  const db = createClient(need("NEXT_PUBLIC_SUPABASE_URL"), need("SUPABASE_SECRET_KEY"), { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: profiles, error: pe } = await db.from("profiles").select("id, email");
  if (pe) throw new Error(`profiles: ${pe.message} (run npm run db:seed first)`);
  const idOf = (email: string) => {
    const id = profiles?.find((p) => p.email === email)?.id as string | undefined;
    if (!id) throw new Error(`no profile for ${email}; run \`npm run db:seed\` first`);
    return id;
  };

  const rows = PLANS.map((p) => {
    const path = join(ROOT, "seed/procedures/jtyu", p.file);
    const name = p.file.split("/").pop()!.replace(/\.py$/, "");
    return { plan: p, name, code: readFileSync(path, "utf8"), sig: signatureOf(path), procId: uid("procedure", name), snapId: uid("snapshot", name, 1) };
  });

  // state_transitions is append-only, so "idempotent" means: procedures that already exist are left alone
  // (`npm run db:seed` wipes everything, after which this script re-creates them)
  const procIds = rows.map((r) => r.procId);
  const must = async <T>(label: string, p: PromiseLike<{ data: T; error: { message: string } | null }>) => {
    const { data, error } = await p;
    if (error) throw new Error(`${label}: ${error.message}`);
    return data;
  };
  const existing = new Set(((await must("existing", db.from("procedures").select("id").in("id", procIds))) ?? []).map((x) => x.id as string));

  const reviewer = idOf("meera.iyer@mos.test");
  const tester = idOf("kabir.singh@mos.test");
  const approver = idOf("nisha.verma@mos.test");

  for (const r of rows) {
    if (existing.has(r.procId)) {
      if (r.plan.endState === "approved") await must("active", db.from("procedures").update({ active_snapshot_id: r.snapId }).eq("id", r.procId).select("id"));
      console.log(`  ${r.name}  already present, skipped`);
      continue;
    }
    const { plan: p } = r;
    const author = idOf(p.author);
    const sha = sha256(r.code);
    const frozen = `frozen/${r.procId}/${r.snapId}-${sha}.py`;
    const up = await db.storage.from(BUCKET).upload(frozen, new Blob([r.code], { type: "text/x-python" }), { upsert: true, contentType: "text/x-python", cacheControl: "no-store" });
    if (up.error) throw new Error(`upload ${frozen}: ${up.error.message}`);

    const t0 = ago(p.daysAgo);
    const tSubmit = ago(p.daysAgo - 1);
    const tReview = ago(p.daysAgo - 2);
    const tTest = ago(p.daysAgo - 3);
    const tApprove = ago(p.daysAgo - 4);
    const end = p.endState;
    const endAt = end === "approved" ? tApprove : tTest;

    await must("procedure", db.from("procedures").insert({ id: r.procId, name: r.name, description: r.sig.doc.split("\n")[0], mission: "JTYU", folder: p.folder, snapshot_seq: 1, created_by: author, created_at: t0 }).select("id"));
    await must(
      "snapshot",
      db
        .from("snapshots")
        .insert({
          id: r.snapId,
          procedure_id: r.procId,
          number: 1,
          author_id: author,
          state: end,
          draft_path: `drafts/${r.snapId}.py`,
          code_path: frozen,
          code_sha256: sha,
          code_bytes: Buffer.byteLength(r.code, "utf8"),
          entrypoint: r.sig.entrypoint,
          signature: { entrypoint: r.sig.entrypoint, params: r.sig.params },
          summary: p.summary,
          submitted_at: tSubmit,
          created_at: t0,
          updated_at: endAt,
        })
        .select("id"),
    );
    const testId = uid("test", r.name);
    await must("test record", db.from("test_records").insert({ id: testId, snapshot_id: r.snapId, tester_id: tester, name: p.testName, result: "pass", notes: p.testNotes, run_id: null, created_at: ago(p.daysAgo - 3, -1) }).select("id"));
    if (p.reviewComment) {
      const line = r.code.split("\n").findIndex((l) => l.includes("read_parameter_until_range")) + 1;
      await must(
        "comment",
        db.from("review_comments").insert({ id: uid("comment", r.name), snapshot_id: r.snapId, author_id: reviewer, line: line || null, body: p.reviewComment, resolved_at: ago(p.daysAgo - 1, -6), resolved_by: author, created_at: ago(p.daysAgo - 2, 2) }).select("id"),
      );
    }
    const trans = [
      { action: "create", from_state: null, to_state: "in_progress", actor: author, comment: null, evidence: {}, at: t0 },
      { action: "submit", from_state: "in_progress", to_state: "ready_for_review", actor: author, comment: p.summary, evidence: {}, at: tSubmit },
      { action: "review_pass", from_state: "ready_for_review", to_state: "test_in_progress", actor: reviewer, comment: null, evidence: {}, at: tReview },
      { action: "test_pass", from_state: "test_in_progress", to_state: "approval_pending", actor: tester, comment: null, evidence: { test_record_ids: [testId], run_ids: [] }, at: tTest },
      ...(end === "approved" ? [{ action: "approve", from_state: "approval_pending", to_state: "approved", actor: approver, comment: null, evidence: {}, at: tApprove }] : []),
    ];
    await must(
      "transitions",
      db
        .from("state_transitions")
        .insert(trans.map((t) => ({ snapshot_id: r.snapId, procedure_id: r.procId, action: t.action, from_state: t.from_state, to_state: t.to_state, actor_id: t.actor, comment: t.comment, related_snapshot_id: null, evidence: t.evidence, created_at: t.at })))
        .select("snapshot_id"),
    );
    await must("event", db.from("procedure_events").insert({ procedure_id: r.procId, kind: "created", actor_id: author, reason: null, detail: {}, created_at: t0 }).select("procedure_id"));
    if (end === "approved") await must("active", db.from("procedures").update({ active_snapshot_id: r.snapId }).eq("id", r.procId).select("id"));
    console.log(`  ${r.name}  #1 ${end}`);
  }

  const bad = ((await must("verify", db.rpc("verify_lifecycle_integrity"))) ?? []) as { problem: string }[];
  if (bad.length) throw new Error("verify_lifecycle_integrity(): " + bad.map((b) => b.problem).join("; "));
  console.log(`Seeded ${rows.length} JTYU procedures; verify_lifecycle_integrity(): no problems`);
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
