/**
 * Lifecycle acceptance tests against the real database (PRD-001 §13), run through the same RPCs the app calls.
 * Every scenario runs inside a transaction that is rolled back, impersonating users via request.jwt.claims.
 * The concurrency test commits to a scratch procedure and removes it afterwards.
 *
 *   npm run db:test
 */
import { config } from "dotenv";
import postgres from "postgres";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
config({ path: join(root, ".env.local"), quiet: true });

type Tx = postgres.TransactionSql;
type Role = "author" | "reviewer" | "tester" | "approver" | "admin";

const sql = postgres(process.env.SUPABASE_DB_URL!, { max: 4, ssl: "require", onnotice: () => {} });
let passed = 0;
const failures: string[] = [];

class Rollback extends Error {}

async function scenario(name: string, body: (tx: Tx, h: Helpers) => Promise<void>) {
  try {
    await sql.begin(async (tx) => {
      await body(tx, helpers(tx));
      throw new Rollback();
    });
  } catch (e) {
    if (e instanceof Rollback) {
      passed++;
      console.log(`  ✓ ${name}`);
      return;
    }
    failures.push(`${name}: ${e instanceof Error ? e.message : e}`);
    console.log(`  ✗ ${name}\n      ${e instanceof Error ? e.message : e}`);
  }
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

type Helpers = ReturnType<typeof helpers>;

function helpers(tx: Tx) {
  async function user(name: string, roles: Role[]): Promise<string> {
    const id = randomUUID();
    await tx`insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
             values (${id}, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
                     ${`${name.toLowerCase()}-${id.slice(0, 8)}@db-test.mos.test`}, ${tx.json({ display_name: name })}, now(), now())`;
    await tx`update public.profiles set roles = ${roles}::public.mos_role[] where id = ${id}`;
    return id;
  }

  async function as<T>(uid: string, fn: () => Promise<T>): Promise<T> {
    await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: uid, role: "authenticated" })}, true)`;
    await tx`set local role authenticated`;
    const out = await fn(); // on error the transaction is aborted; expectError rolls back to its savepoint
    await tx`reset role`;
    return out;
  }

  async function expectError(fn: () => Promise<unknown>, pattern: RegExp, what: string) {
    await tx`savepoint expect_error`;
    try {
      await fn();
    } catch (e) {
      await tx`rollback to savepoint expect_error`;
      await tx`reset role`;
      const msg = e instanceof Error ? e.message : String(e);
      assert(pattern.test(msg), `${what}: expected error ${pattern}, got "${msg}"`);
      return;
    }
    throw new Error(`${what}: expected a refusal but it succeeded`);
  }

  async function newProcedure(author: string, name = `DBTEST_${randomUUID().slice(0, 8)}`) {
    const res = await as(author, async () => (await tx`select public.create_procedure(${name}, 'test', 'FF', 'TEST') as r`)[0].r);
    return res as { procedure_id: string; snapshot_id: string };
  }

  /** Simulates the server freezing the draft object, then submits through the RPC. */
  async function submit(author: string, snapshotId: string, fork = false) {
    const [s] = await tx`select procedure_id from public.snapshots where id = ${snapshotId}`;
    const sha = randomUUID().replace(/-/g, "").padEnd(64, "0").slice(0, 64);
    const path = `frozen/${s.procedure_id}/${snapshotId}-${sha}.py`;
    await tx`insert into storage.objects (bucket_id, name) values ('procedure-code', ${path})`;
    return as(
      author,
      async () =>
        (await tx`select public.submit_snapshot(${snapshotId}, 'change summary', ${path}, ${sha}, 42, 'Proc', ${tx.json({ entrypoint: "Proc", params: [] })}, ${fork}) as r`)[0]
          .r as { submitted_id: string; fork_id: string | null },
    );
  }

  async function move(uid: string, snapshotId: string, action: string, comment: string | null = "because") {
    return as(uid, async () => (await tx`select public.transition_snapshot(${snapshotId}, ${action}::public.snapshot_action, ${comment}) as r`)[0].r);
  }

  async function state(snapshotId: string): Promise<string> {
    return (await tx`select state from public.snapshots where id = ${snapshotId}`)[0].state;
  }

  async function newWorkingCopy(author: string, procedureId: string, parent: string | null) {
    return as(author, async () => (await tx`select public.create_working_copy(${procedureId}, ${parent}) as r`)[0].r as { snapshot_id: string });
  }

  async function team() {
    return {
      author: await user("Author", ["author"]),
      author2: await user("Author2", ["author"]),
      reviewer: await user("Reviewer", ["reviewer"]),
      tester: await user("Tester", ["tester"]),
      approver: await user("Approver", ["approver"]),
      approver2: await user("Approver2", ["approver", "reviewer"]),
    };
  }

  /** Drives a fresh snapshot all the way to Approved. */
  async function approvedSnapshot(t: Awaited<ReturnType<typeof team>>, procedureId: string, parent: string | null) {
    const wc = await newWorkingCopy(t.author, procedureId, parent);
    await submit(t.author, wc.snapshot_id);
    await move(t.reviewer, wc.snapshot_id, "review_pass", null);
    await move(t.tester, wc.snapshot_id, "test_pass", null);
    await move(t.approver, wc.snapshot_id, "approve", null);
    return wc.snapshot_id;
  }

  return { user, as, expectError, newProcedure, submit, move, state, newWorkingCopy, team, approvedSnapshot };
}

/** Direct deletes from storage tables are blocked by Supabase; go through the Storage API. */
async function removeStoredObjects(prefix: string) {
  const storage = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false },
  }).storage.from("procedure-code");
  const { data } = await storage.list(prefix, { limit: 1000 });
  if (data?.length) await storage.remove(data.map((o) => `${prefix}/${o.name}`));
}

async function main() {
  console.log("Lifecycle acceptance tests (PRD-001 §13)\n");

  await scenario("A1 new procedure is In Progress with no submitted snapshots", async (tx, h) => {
    const t = await h.team();
    const p = await h.newProcedure(t.author);
    assert((await h.state(p.snapshot_id)) === "in_progress", "first snapshot should be in_progress");
    const [{ n }] = await tx`select count(*)::int as n from public.snapshots where procedure_id = ${p.procedure_id} and state <> 'in_progress'`;
    assert(n === 0, "no frozen snapshots expected");
  });

  await scenario("A2/R11 submit creates a snapshot in Ready for Review and the working copy stays editable (auto-fork)", async (tx, h) => {
    const t = await h.team();
    const p = await h.newProcedure(t.author);
    const r = await h.submit(t.author, p.snapshot_id, true);
    assert((await h.state(p.snapshot_id)) === "ready_for_review", "submitted should be ready_for_review");
    assert(r.fork_id && (await h.state(r.fork_id)) === "in_progress", "fork should be in_progress");
    const [{ parent }] = await tx`select parent_snapshot_id as parent from public.snapshots where id = ${r.fork_id}`;
    assert(parent === p.snapshot_id, "fork's parent should be the submitted snapshot");
  });

  await scenario("A3 a snapshot always has exactly one state", async (tx, h) => {
    const t = await h.team();
    const p = await h.newProcedure(t.author);
    const rows = await tx`select state from public.snapshots where id = ${p.snapshot_id}`;
    assert(rows.length === 1 && typeof rows[0].state === "string", "one state");
  });

  await scenario("A4/R4 Review Failed refuses every move", async (_tx, h) => {
    const t = await h.team();
    const p = await h.newProcedure(t.author);
    await h.submit(t.author, p.snapshot_id);
    await h.move(t.reviewer, p.snapshot_id, "review_fail", "missing timeout handling");
    for (const action of ["review_pass", "test_pass", "approve", "retest", "send_back", "reactivate"]) {
      const who = action.startsWith("review") ? t.reviewer : action.startsWith("test") || action === "retest" ? t.tester : t.approver;
      await h.expectError(() => h.move(who, p.snapshot_id, action), /cannot be moved/, `review_failed → ${action}`);
    }
  });

  await scenario("A5/R5 Test Failed can be retested without a new submission (tester or author)", async (_tx, h) => {
    const t = await h.team();
    const p = await h.newProcedure(t.author);
    await h.submit(t.author, p.snapshot_id);
    await h.move(t.reviewer, p.snapshot_id, "review_pass", null);
    await h.move(t.tester, p.snapshot_id, "test_fail", "sim setup wrong");
    await h.move(t.author, p.snapshot_id, "retest", "sim fixed");
    assert((await h.state(p.snapshot_id)) === "test_in_progress", "retest returns to 3a");
  });

  await scenario("A6 Test Failed cannot go to Approved", async (_tx, h) => {
    const t = await h.team();
    const p = await h.newProcedure(t.author);
    await h.submit(t.author, p.snapshot_id);
    await h.move(t.reviewer, p.snapshot_id, "review_pass", null);
    await h.move(t.tester, p.snapshot_id, "test_fail", "x");
    await h.expectError(() => h.move(t.approver, p.snapshot_id, "approve", null), /cannot be moved/, "approve from 4b");
  });

  await scenario("A7/R1 approving A supersedes B; one approved per procedure", async (tx, h) => {
    const t = await h.team();
    const p = await h.newProcedure(t.author);
    const b = await h.approvedSnapshot(t, p.procedure_id, null);
    const a = await h.approvedSnapshot(t, p.procedure_id, b);
    assert((await h.state(a)) === "approved", "A approved");
    assert((await h.state(b)) === "superseded", "B superseded");
    const [{ active, n }] = await tx`select (select active_snapshot_id from public.procedures where id = ${p.procedure_id}) as active,
                                            (select count(*)::int from public.snapshots where procedure_id = ${p.procedure_id} and state = 'approved') as n`;
    assert(active === a && n === 1, "active pointer = A and exactly one approved");
    const [sup] = await tx`select related_snapshot_id from public.state_transitions where snapshot_id = ${b} and action = 'supersede'`;
    assert(sup?.related_snapshot_id === a, "supersede row points at A");
  });

  await scenario("A8/R6c re-approving superseded B is a rollback with no review/test", async (tx, h) => {
    const t = await h.team();
    const p = await h.newProcedure(t.author);
    const b = await h.approvedSnapshot(t, p.procedure_id, null);
    const a = await h.approvedSnapshot(t, p.procedure_id, b);
    await h.move(t.approver, b, "reactivate", "A misbehaved on pass 1182");
    assert((await h.state(b)) === "approved" && (await h.state(a)) === "superseded", "B active, A superseded");
    const [row] = await tx`select related_snapshot_id, comment from public.state_transitions where snapshot_id = ${b} and action = 'reactivate'`;
    assert(row.related_snapshot_id === a && /1182/.test(row.comment), "rollback is traceable: which snapshot replaced which, and why");
  });

  await scenario("A9 (your rule) the active snapshot cannot be withdrawn directly; switch first, then withdraw", async (tx, h) => {
    const t = await h.team();
    const p = await h.newProcedure(t.author);
    const b = await h.approvedSnapshot(t, p.procedure_id, null);
    const a = await h.approvedSnapshot(t, p.procedure_id, b);
    await h.expectError(() => h.move(t.approver, a, "withdraw", "bad"), /cannot be withdrawn directly/, "withdraw active");
    await h.move(t.approver, b, "reactivate", "switch back before withdrawing A");
    await h.move(t.approver, a, "withdraw", "A is unsafe");
    assert((await h.state(a)) === "withdrawn" && (await h.state(b)) === "approved", "A withdrawn, B active");
    await h.move(t.approver, a, "reactivate", "fixed in ground config");
    assert((await h.state(a)) === "approved" && (await h.state(b)) === "superseded", "withdrawn can be re-approved");
    void tx;
  });

  await scenario("A10/A11/A12 refuse → Approval Failed; cannot approve from there; send back to retest", async (_tx, h) => {
    const t = await h.team();
    const p = await h.newProcedure(t.author);
    await h.submit(t.author, p.snapshot_id);
    await h.move(t.reviewer, p.snapshot_id, "review_pass", null);
    await h.move(t.tester, p.snapshot_id, "test_pass", null);
    await h.move(t.approver, p.snapshot_id, "refuse", "test cases don't cover eclipse");
    assert((await h.state(p.snapshot_id)) === "approval_failed", "5b");
    await h.expectError(() => h.move(t.approver, p.snapshot_id, "approve", null), /cannot be moved/, "approve from 5b");
    await h.move(t.approver, p.snapshot_id, "send_back", "add eclipse cases");
    assert((await h.state(p.snapshot_id)) === "test_in_progress", "back to 3a");
  });

  await scenario("A13/R8 every change records user, time, from, to and snapshot", async (tx, h) => {
    const t = await h.team();
    const p = await h.newProcedure(t.author);
    await h.approvedSnapshot(t, p.procedure_id, null);
    const rows = await tx`select actor_id, created_at, from_state, to_state, snapshot_id, action from public.state_transitions where procedure_id = ${p.procedure_id}`;
    assert(rows.length >= 6, `expected ≥6 audit rows, got ${rows.length}`);
    assert(rows.every((r) => r.actor_id && r.created_at && r.to_state && r.snapshot_id && (r.from_state || r.action === "create")), "complete rows");
  });

  await scenario("A14/A15/R7 retire keeps snapshot states; restore brings the approved one back", async (tx, h) => {
    const t = await h.team();
    const p = await h.newProcedure(t.author);
    const a = await h.approvedSnapshot(t, p.procedure_id, null);
    await h.as(t.approver, () => tx`select public.set_procedure_retired(${p.procedure_id}, true, 'replaced by new FDIR flow')`);
    assert((await h.state(a)) === "approved", "state kept while retired");
    await h.expectError(() => h.newWorkingCopy(t.author, p.procedure_id, a), /retired/, "new work on retired procedure");
    await h.as(t.approver, () => tx`select public.set_procedure_retired(${p.procedure_id}, false, 'needed for LEOP')`);
    const [{ active }] = await tx`select active_snapshot_id as active from public.procedures where id = ${p.procedure_id}`;
    assert(active === a, "approved snapshot back in PROD");
  });

  await scenario("A17/R10 editing the working copy never changes a snapshot in review", async (tx, h) => {
    const t = await h.team();
    const p = await h.newProcedure(t.author);
    const r = await h.submit(t.author, p.snapshot_id, true);
    const [before] = await tx`select code_path, code_sha256, state from public.snapshots where id = ${p.snapshot_id}`;
    await tx`update public.snapshots set updated_at = now() where id = ${r.fork_id}`; // what autosave touches
    const [after] = await tx`select code_path, code_sha256, state from public.snapshots where id = ${p.snapshot_id}`;
    assert(JSON.stringify(before) === JSON.stringify(after), "submitted snapshot unchanged");
  });

  await scenario("Separation of duties: no self-review, no self-approval, reviewer ≠ approver", async (tx, h) => {
    const t = await h.team();
    const both = await h.user("ReviewerApprover", ["reviewer", "approver", "author"]);
    const p = await h.newProcedure(both);
    await h.submit(both, p.snapshot_id);
    await h.expectError(() => h.move(both, p.snapshot_id, "review_pass", null), /own snapshot/, "self review");
    const q = await h.newProcedure(t.author);
    await h.submit(t.author, q.snapshot_id);
    await h.move(both, q.snapshot_id, "review_pass", null);
    await h.move(t.tester, q.snapshot_id, "test_pass", null);
    await h.expectError(() => h.move(both, q.snapshot_id, "approve", null), /reviewed this snapshot/, "reviewer approves");
    await tx`update public.app_settings set allow_self_actions = true`;
    await h.move(both, q.snapshot_id, "approve", null);
    assert((await h.state(q.snapshot_id)) === "approved", "allowed when self-actions are enabled");
  });

  await scenario("Roles are enforced and comments are required for negative moves", async (_tx, h) => {
    const t = await h.team();
    const p = await h.newProcedure(t.author);
    await h.submit(t.author, p.snapshot_id);
    await h.expectError(() => h.move(t.tester, p.snapshot_id, "review_pass", null), /reviewer role/, "tester reviewing");
    await h.expectError(() => h.move(t.reviewer, p.snapshot_id, "review_fail", " "), /comment is required/, "fail without comment");
    await h.expectError(() => h.newProcedure(t.tester), /author role/, "tester creating procedure");
  });

  await scenario("The one-approved rule holds even against direct writes (partial unique index)", async (tx, h) => {
    const t = await h.team();
    const p = await h.newProcedure(t.author);
    await h.approvedSnapshot(t, p.procedure_id, null);
    const b = await h.newWorkingCopy(t.author, p.procedure_id, null);
    await h.submit(t.author, b.snapshot_id);
    await h.expectError(() => tx`update public.snapshots set state = 'approved' where id = ${b.snapshot_id}`, /one_approved_per_procedure/, "second approved row");
  });

  await scenario("Audit tables are append-only and clients cannot write snapshots directly", async (tx, h) => {
    const t = await h.team();
    const p = await h.newProcedure(t.author);
    await h.expectError(() => tx`update public.state_transitions set comment = 'tampered' where procedure_id = ${p.procedure_id}`, /append-only/, "update audit");
    await h.expectError(() => tx`delete from public.procedure_events where procedure_id = ${p.procedure_id}`, /append-only/, "delete audit");
    await h.expectError(
      () => h.as(t.author, () => tx`update public.snapshots set state = 'approved' where id = ${p.snapshot_id}`),
      /permission denied/,
      "client direct state write",
    );
  });

  await scenario("Submit refuses a frozen path that the server did not write", async (tx, h) => {
    const t = await h.team();
    const p = await h.newProcedure(t.author);
    const sha = "a".repeat(64);
    const path = `frozen/${p.procedure_id}/${p.snapshot_id}-${sha}.py`;
    await h.expectError(
      () => h.as(t.author, () => tx`select public.submit_snapshot(${p.snapshot_id}, 'x', ${path}, ${sha}, 1, 'P', '{}'::jsonb, false)`),
      /missing/,
      "submit without object",
    );
  });

  // Concurrency: two approvers race to approve two different snapshots of the same procedure.
  const concurrencyName = "Concurrent approvals serialize on the procedure lock: both commit, exactly one ends approved";
  const scratch: { procedure?: string; users: string[] } = { users: [] };
  try {
    const ids = await sql.begin(async (tx) => {
      const h = helpers(tx);
      const t = await h.team();
      scratch.users = Object.values(t);
      const p = await h.newProcedure(t.author);
      scratch.procedure = p.procedure_id;
      const s1 = await h.newWorkingCopy(t.author, p.procedure_id, null);
      const s2 = await h.newWorkingCopy(t.author2, p.procedure_id, null);
      for (const [s, a] of [[s1.snapshot_id, t.author], [s2.snapshot_id, t.author2]] as const) {
        await h.submit(a, s);
        await h.move(t.reviewer, s, "review_pass", null);
        await h.move(t.tester, s, "test_pass", null);
      }
      return { s1: s1.snapshot_id, s2: s2.snapshot_id, a1: t.approver, a2: t.approver2 };
    });
    const race = (snap: string, uid: string) =>
      sql.begin(async (tx) => {
        await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: uid, role: "authenticated" })}, true)`;
        await tx`set local role authenticated`;
        await tx`select public.transition_snapshot(${snap}, 'approve', null)`;
        await tx`select pg_sleep(0.3)`;
      });
    await Promise.all([race(ids.s1, ids.a1), race(ids.s2, ids.a2)]);
    const states = await sql`select state from public.snapshots where id in (${ids.s1}, ${ids.s2})`;
    const approved = states.filter((r) => r.state === "approved").length;
    const superseded = states.filter((r) => r.state === "superseded").length;
    assert(approved === 1 && superseded === 1, `expected 1 approved + 1 superseded, got ${JSON.stringify(states)}`);
    const [{ name }] = await sql`select name from public.procedures where id = ${scratch.procedure!}`;
    const problems = (await sql`select * from public.verify_lifecycle_integrity()`).filter((p) => String(p.problem).includes(name));
    assert(problems.length === 0, `integrity: ${JSON.stringify(problems)}`);
    passed++;
    console.log(`  ✓ ${concurrencyName}`);
  } catch (e) {
    failures.push(`${concurrencyName}: ${e instanceof Error ? e.message : e}`);
    console.log(`  ✗ ${concurrencyName}\n      ${e instanceof Error ? e.message : e}`);
  } finally {
    await sql.begin(async (tx) => {
      await tx`select set_config('mos.discarding_working_copy', 'on', true)`;
      if (scratch.procedure) {
        await tx`update public.procedures set active_snapshot_id = null where id = ${scratch.procedure}`;
        await tx`delete from public.procedure_events where procedure_id = ${scratch.procedure}`.catch(() => undefined);
      }
    }).catch(() => undefined);
    // procedure_events are append-only even for cleanup; drop the trigger guard only inside this cleanup transaction.
    await sql.begin(async (tx) => {
      await tx`alter table public.procedure_events disable trigger procedure_events_append_only`;
      await tx`alter table public.state_transitions disable trigger state_transitions_append_only`;
      if (scratch.procedure) {
        await tx`update public.procedures set active_snapshot_id = null where id = ${scratch.procedure}`;
        await tx`delete from public.procedures where id = ${scratch.procedure}`;
      }
      if (scratch.users.length) await tx`delete from auth.users where id in ${tx(scratch.users)}`;
      await tx`alter table public.procedure_events enable trigger procedure_events_append_only`;
      await tx`alter table public.state_transitions enable trigger state_transitions_append_only`;
    });
    if (scratch.procedure) await removeStoredObjects(`frozen/${scratch.procedure}`);
  }

  console.log(`\n${passed} passed, ${failures.length} failed`);
  await sql.end({ timeout: 5 });
  if (failures.length) process.exit(1);
}

main().catch(async (e) => {
  console.error(e);
  await sql.end({ timeout: 1 });
  process.exit(1);
});
