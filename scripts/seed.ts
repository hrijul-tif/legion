/**
 * Seeds the demo data into Supabase. Idempotent: wipes the demo tables and the procedure-code bucket first.
 *
 *   npm run db:seed              seed the project in .env.local
 *   npm run db:seed -- --dry-run replay + validate the history locally, touch nothing
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY and DEMO_PASSWORD in .env.local, and the migrations applied
 * (`npm run db:setup`). Every row is written with the service role directly (the lifecycle RPCs use auth.uid() and
 * now()), so the history is backdated; the semantics mirror the RPCs and `verify_lifecycle_integrity()` must come
 * back empty at the end.
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { join } from "node:path";
import { PERSONAS } from "../lib/personas";
import { ROOT, createHarness } from "../seed/harness";
import { PROCEDURES } from "../seed/manifest";
import { must, pool, writeRows, type Db } from "../seed/db";
import { replay, sha256 } from "../seed/replay";
import { validateOutput } from "../seed/validate";
import type { ReplayOutput } from "../seed/types";

config({ path: join(ROOT, ".env.local"), quiet: true });

const BUCKET = "procedure-code";
const dryRun = process.argv.includes("--dry-run");

function need(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing ${name} in .env.local${name === "SUPABASE_SECRET_KEY" ? " (Dashboard -> Project Settings -> API Keys -> Secret keys)" : ""}.`);
    process.exit(1);
  }
  return v;
}

/* --------------------------------------------------------------------------------------------- auth + profiles */
async function ensureUsers(db: Db, password: string): Promise<Map<string, string>> {
  const existing = new Map<string, string>();
  for (let page = 1; ; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`list users: ${error.message}`);
    for (const u of data.users) if (u.email) existing.set(u.email.toLowerCase(), u.id);
    if (data.users.length < 200) break;
  }
  const ids = new Map<string, string>();
  for (const p of PERSONAS) {
    const known = existing.get(p.email.toLowerCase());
    if (known) {
      const { error } = await db.auth.admin.updateUserById(known, { password, email_confirm: true, user_metadata: { display_name: p.displayName } });
      if (error) throw new Error(`update ${p.email}: ${error.message}`);
      ids.set(p.email, known);
    } else {
      const { data, error } = await db.auth.admin.createUser({ email: p.email, password, email_confirm: true, user_metadata: { display_name: p.displayName } });
      if (error || !data.user) throw new Error(`create ${p.email}: ${error?.message}`);
      ids.set(p.email, data.user.id);
    }
  }
  // the on_auth_user_created trigger inserted a bare profile; set the real one
  await must(
    "upsert profiles",
    db.from("profiles").upsert(
      PERSONAS.map((p) => ({ id: ids.get(p.email)!, email: p.email, display_name: p.displayName, initials: p.initials, color: p.color, title: p.title, roles: p.roles })),
      { onConflict: "id" },
    ),
  );
  return ids;
}

/* --------------------------------------------------------------------------------------------- storage */
async function listAllObjects(db: Db, prefix: string): Promise<string[]> {
  const files: string[] = [];
  const stack = [prefix];
  while (stack.length) {
    const dir = stack.pop()!;
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await db.storage.from(BUCKET).list(dir, { limit: 1000, offset });
      if (error) throw new Error(`list ${dir}: ${error.message}`);
      if (!data?.length) break;
      for (const e of data) {
        const path = `${dir}/${e.name}`;
        if (e.id === null) stack.push(path);
        else files.push(path);
      }
      if (data.length < 1000) break;
    }
  }
  return files;
}

async function purgeBucket(db: Db): Promise<number> {
  const files = [...(await listAllObjects(db, "drafts")), ...(await listAllObjects(db, "frozen"))];
  for (let i = 0; i < files.length; i += 100) {
    const { error } = await db.storage.from(BUCKET).remove(files.slice(i, i + 100));
    if (error) throw new Error(`remove objects: ${error.message}`);
  }
  return files.length;
}

async function uploadCode(db: Db, out: ReplayOutput) {
  await pool(out.codes, 6, async (c) => {
    const { error } = await db.storage.from(BUCKET).upload(c.path, new Blob([c.text], { type: "text/x-python" }), { upsert: true, contentType: "text/x-python", cacheControl: "no-store" });
    if (error) throw new Error(`upload ${c.path}: ${error.message}`);
  });
}

async function verifyStorage(db: Db, out: ReplayOutput) {
  const bad: string[] = [];
  await pool(out.codes, 6, async (c) => {
    const { data, error } = await db.storage.from(BUCKET).download(c.path);
    if (error || !data) return void bad.push(`${c.path}: ${error?.message}`);
    const text = await data.text();
    if (text !== c.text) bad.push(`${c.path}: content differs`);
    if (c.kind === "frozen" && !c.path.endsWith(`-${sha256(text)}.py`)) bad.push(`${c.path}: sha256 in the path does not match the content`);
  });
  if (bad.length) throw new Error(`storage verification failed:\n  ${bad.join("\n  ")}`);
}

/* --------------------------------------------------------------------------------------------- summary */
function printSummary(out: ReplayOutput) {
  const states: Record<string, number> = {};
  for (const s of out.snapshots) states[s.state] = (states[s.state] ?? 0) + 1;
  console.log("\nSeed summary");
  console.log(`  procedures           ${out.procedures.length} (${out.procedures.filter((p) => p.retired_at).length} retired, ${out.procedures.filter((p) => p.active_snapshot_id).length} with an active snapshot)`);
  console.log(`  snapshots            ${out.snapshots.length}`);
  for (const [k, v] of Object.entries(states).sort()) console.log(`    ${k.padEnd(18)} ${v}`);
  console.log(`  state transitions    ${out.transitions.length}`);
  console.log(`  procedure events     ${out.events.length}`);
  console.log(`  review comments      ${out.comments.length} (${out.comments.filter((c) => c.resolved_at).length} resolved)`);
  console.log(`  test records         ${out.tests.length}`);
  console.log(`  runs                 ${out.runs.length}`);
  console.log(`  code objects         ${out.codes.length}`);
}

function printLogins() {
  console.log("\nDemo logins (password: DEMO_PASSWORD from .env.local)");
  for (const p of PERSONAS) console.log(`  ${p.email.padEnd(24)} ${p.displayName.padEnd(13)} ${p.roles.join(", ")}`);
}

async function main() {
  console.log("Replaying the seed history on the mock spacecraft ...");
  const harness = await createHarness();
  const out = replay(PROCEDURES, { now: new Date(), harness });
  const problems = validateOutput(out);
  if (problems.length) {
    console.error("The seed history is inconsistent:\n  " + problems.join("\n  "));
    process.exit(1);
  }
  printSummary(out);
  if (dryRun) {
    console.log("\n--dry-run: nothing written.");
    return;
  }

  const url = need("NEXT_PUBLIC_SUPABASE_URL");
  const key = need("SUPABASE_SECRET_KEY");
  const password = need("DEMO_PASSWORD");
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const probe = await db.rpc("verify_lifecycle_integrity");
  if (probe.error) {
    console.error(`The database is not ready: ${probe.error.message}\nApply the migrations first: npm run db:setup`);
    process.exit(1);
  }

  console.log("\nUsers and profiles ...");
  const ids = await ensureUsers(db, password);
  const uid = (email: string) => {
    const id = ids.get(email);
    if (!id) throw new Error(`no user for ${email}`);
    return id;
  };

  console.log("Resetting demo data and storage ...");
  await must("reset_demo_data", db.rpc("reset_demo_data"));
  await must("allow_self_actions", db.from("app_settings").update({ allow_self_actions: false }).eq("id", true).select("id"));
  const removed = await purgeBucket(db);
  console.log(`  removed ${removed} stored objects`);

  console.log("Uploading code ...");
  await uploadCode(db, out);
  console.log("Writing history ...");
  await writeRows(db, out, uid);

  console.log("Verifying ...");
  const bad = await must("verify_lifecycle_integrity", db.rpc("verify_lifecycle_integrity"));
  const rows = (bad ?? []) as { problem: string }[];
  if (rows.length) {
    console.error("verify_lifecycle_integrity() reported problems:\n  " + rows.map((r) => r.problem).join("\n  "));
    process.exit(1);
  }
  await verifyStorage(db, out);

  // what the app will see
  const counts: Record<string, number> = {};
  for (const t of ["procedures", "snapshots", "state_transitions", "procedure_events", "review_comments", "test_records", "runs"]) {
    const { count, error } = await db.from(t).select("*", { count: "exact", head: true });
    if (error) throw new Error(`count ${t}: ${error.message}`);
    counts[t] = count ?? 0;
  }
  const expected: Record<string, number> = {
    procedures: out.procedures.length,
    snapshots: out.snapshots.length,
    state_transitions: out.transitions.length,
    procedure_events: out.events.length,
    review_comments: out.comments.length,
    test_records: out.tests.length,
    runs: out.runs.length,
  };
  for (const [t, n] of Object.entries(expected)) if (counts[t] !== n) throw new Error(`${t}: expected ${n} rows, found ${counts[t]}`);

  console.log("  verify_lifecycle_integrity(): no problems");
  console.log(`  row counts in the database: ${JSON.stringify(counts)}`);
  console.log(`  ${out.codes.length} stored objects match their sha256`);
  printLogins();
  console.log("\nDone.");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
