/**
 * Offline test of the seed data (no database needed):
 *   - every seed procedure file (latest + historical versions) passes the MOS checker with zero errors,
 *     only uses commands/parameters that exist in the FF catalog, and runs to `completed` on the mock spacecraft
 *     with its default dry-run arguments (warp: infinity, prompts auto-answered with "5: Stop execution" so a hang
 *     shows up as a failure);
 *   - the manifest replays cleanly through the lifecycle state machine and satisfies the database invariants;
 *   - the demo storylines and per-persona queues are all there.
 *
 *   npm run test:seeds
 */
import { config } from "dotenv";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { QUEUE_STATES, STALE_AFTER_DAYS } from "../lib/lifecycle";
import { PERSONAS } from "../lib/personas";
import { ROOT, createHarness } from "../seed/harness";
import { PROCEDURES } from "../seed/manifest";
import { SEED_DIR, personaEmail, readCode, replay } from "../seed/replay";
import { validateOutput } from "../seed/validate";

config({ path: join(ROOT, ".env.local"), quiet: true });

let passed = 0;
const failures: string[] = [];
function check(name: string, cond: unknown, detail?: unknown) {
  if (cond) passed++;
  else {
    failures.push(name + (detail === undefined ? "" : ` -> ${typeof detail === "string" ? detail : JSON.stringify(detail)}`));
    console.log(`  FAIL ${name}${detail === undefined ? "" : ` -> ${typeof detail === "string" ? detail : JSON.stringify(detail).slice(0, 400)}`}`);
  }
}
const section = (s: string) => console.log(`- ${s}`);

interface Catalog {
  commands: Record<string, unknown>;
  parameters: Record<string, unknown>;
  enums: Record<string, unknown>;
  paramEnums: Record<string, unknown>;
}

function catalogProblems(code: string, cat: Catalog): string[] {
  const out: string[] = [];
  const aliases = (kind: "commands" | "parameters") =>
    [...code.matchAll(new RegExp(`import\\s+framework\\.ff\\.${kind}\\s+as\\s+(\\w+)`, "g"))].map((m) => m[1]);
  for (const a of aliases("commands"))
    for (const m of code.matchAll(new RegExp(`\\b${a}\\.(\\w+)`, "g")))
      if (!(m[1] in cat.commands) && !(m[1] in cat.enums)) out.push(`${a}.${m[1]}`);
  for (const a of aliases("parameters"))
    for (const m of code.matchAll(new RegExp(`\\b${a}\\.(\\w+)`, "g")))
      if (!(m[1] in cat.parameters) && !(m[1] in cat.paramEnums)) out.push(`${a}.${m[1]}`);
  return [...new Set(out)];
}

async function main() {
  const t0 = Date.now();
  const harness = await createHarness();
  const catalog = JSON.parse(readFileSync(join(ROOT, "public/catalog/ff.json"), "utf8")) as Catalog;

  /* ---------------------------------------------------------------------------------------------- files */
  section("seed files");
  const used = new Set<string>();
  for (const proc of PROCEDURES) {
    check(`${proc.name}: file path matches folder/name`, proc.file === `procedures/ff/${proc.folder}/${proc.name}.py`, proc.file);
    const refs = new Set(proc.history.filter((s) => s.op === "create").map((s) => (s as { code: string }).code));
    for (const ref of refs) {
      const key = `${proc.name}@${ref}`;
      used.add(ref === "main" ? proc.file : `procedures/ff/_versions/${proc.name}.${ref}.py`);
      let code: string;
      try {
        code = readCode(proc, ref);
      } catch (e) {
        check(`${key}: file readable`, false, String(e));
        continue;
      }
      const lint = harness.lint(code);
      const errs = lint.diagnostics.filter((d) => d.severity === "error");
      check(`${key}: MOS checker has zero errors`, errs.length === 0, errs.map((d) => `${d.code}@${d.startLine} ${d.message}`));
      const warns = lint.diagnostics.filter((d) => d.severity === "warning");
      check(`${key}: MOS checker has no warnings`, warns.length === 0, warns.map((d) => `${d.code}@${d.startLine} ${d.message}`));
      check(`${key}: only catalog commands/parameters`, catalogProblems(code, catalog).length === 0, catalogProblems(code, catalog));
      check(`${key}: no local file / process access in the code`, !/\bopen\(|\bos\.|subprocess|expanduser/.test(code));

      // run on the mock with the default arguments
      const res = harness.run(code, { args: proc.defaultArgs });
      const runErrors = res.events.filter((e) => e.type === "log" && e.logger === "run" && e.level === "error").map((e) => (e as { msg: string }).msg.trim());
      const runWarnings = res.events.filter((e) => e.type === "log" && e.logger === "run" && e.level === "warning").map((e) => (e as { msg: string }).msg.trim());
      const simNotes = res.events.filter((e) => e.type === "log" && e.logger === "sim" && e.level !== "info" && e.level !== "debug").map((e) => (e as { msg: string }).msg);
      check(`${key}: runs to completed on the mock`, res.outcome === "completed", { outcome: res.outcome, error: res.error, prompts: res.prompts.map((p) => p.message.slice(0, 80)) });
      check(`${key}: no prompts`, res.prompts.length === 0, res.prompts.map((p) => p.message));
      check(`${key}: no errors in the run log`, runErrors.length === 0, runErrors);
      check(`${key}: no warnings in the run log`, runWarnings.length === 0, runWarnings.slice(0, 3));
      check(`${key}: sim file has no unknown names`, simNotes.length === 0, simNotes.slice(0, 3));
      check(`${key}: issued at least one command or TM read`, res.events.some((e) => e.type === "command" || e.type === "tm"));
    }
  }
  const allFiles: string[] = [];
  const walk = (dir: string, rel = "") => {
    for (const e of readdirSync(join(dir, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(dir, r);
      else if (e.name.endsWith(".py")) allFiles.push(`procedures/ff/${r}`.replace("procedures/ff/", "procedures/ff/"));
    }
  };
  walk(join(SEED_DIR, "procedures/ff"));
  for (const f of allFiles) check(`${f}: referenced by the manifest`, used.has(f));
  check("about 20 procedures", PROCEDURES.length >= 18 && PROCEDURES.length <= 24, PROCEDURES.length);
  const subsystems = new Set(PROCEDURES.map((p) => p.folder.split("/")[0]));
  for (const s of ["EPS", "AOC", "FSW", "SBAND", "THM", "PRP", "PAYLOAD", "CHECKOUT"]) check(`subsystem ${s} covered`, subsystems.has(s));

  /* ---------------------------------------------------------------------------------------------- replay */
  section("replay + database invariants");
  const now = new Date();
  const out = replay(PROCEDURES, { now, harness });
  const problems = validateOutput(out);
  check("verify_lifecycle_integrity equivalent: no problems", problems.length === 0, problems);

  const proc = (name: string) => out.procedures.find((p) => p.name.includes(name));
  const snaps = (name: string) => out.snapshots.filter((s) => s.procedure_id === proc(name)!.id).sort((a, b) => a.number - b.number);
  const snap = (name: string, n: number) => snaps(name).find((s) => s.number === n)!;
  const trans = (name: string, n: number) => out.transitions.filter((t) => t.snapshot_id === snap(name, n).id);
  const days = (iso: string) => (now.getTime() - Date.parse(iso)) / 86_400_000;
  const lastChange = (name: string, n: number) => days(trans(name, n).at(-1)!.created_at);

  section("storylines");
  {
    // superseded -> approved chain
    const e = snaps("EPS_181");
    check("EPS_181: #1 superseded by #2 which is approved", e[0].state === "superseded" && e[0].superseded_by_snapshot_id === e[1].id && e[1].state === "approved");
    const sup = trans("EPS_181", 1).find((t) => t.action === "supersede");
    check("EPS_181: supersede row points at #2", sup?.related_snapshot_id === e[1].id);
    const appr = trans("EPS_181", 2).find((t) => t.action === "approve");
    check("EPS_181: approve row points at the superseded #1", appr?.related_snapshot_id === e[0].id);
    // working copies of two authors forked from the active snapshot
    const wcs = e.filter((s) => s.state === "in_progress");
    check("EPS_181: two working copies from two authors, forked from the active #2", wcs.length === 2 && new Set(wcs.map((w) => w.author)).size === 2 && wcs.every((w) => w.parent_snapshot_id === e[1].id), wcs.map((w) => [w.author, w.parent_snapshot_id]));
    check("EPS_181: working copies are Asha and Rohan", wcs.some((w) => w.author === personaEmail("asha")) && wcs.some((w) => w.author === personaEmail("rohan")));
    const draftCodes = wcs.map((w) => out.codes.find((c) => c.path === w.draft_path)!.text);
    const active = out.codes.find((c) => c.path === e[1].code_path)!.text;
    check("EPS_181: each working copy has a small edit of the active code", draftCodes.every((c) => c !== active && Math.abs(c.split("\n").length - active.split("\n").length) <= 2));
  }
  {
    // rollback incident
    const f = snaps("FSW_04");
    const states = f.map((s) => s.state);
    check("FSW_04: #1 superseded, #2 approved (active), #3 withdrawn, #4 working copy", JSON.stringify(states) === JSON.stringify(["superseded", "approved", "withdrawn", "in_progress"]), states);
    check("FSW_04: active pointer is #2", proc("FSW_04")!.active_snapshot_id === f[1].id);
    const re = trans("FSW_04", 2).find((t) => t.action === "reactivate");
    check("FSW_04: reactivate row has the incident reason and points at #3", !!re && /pass 1182/.test(re.comment ?? "") && re.related_snapshot_id === f[2].id);
    check("FSW_04: #3 superseded (rollback) then withdrawn", JSON.stringify(trans("FSW_04", 3).map((t) => t.action).slice(-3)) === JSON.stringify(["approve", "supersede", "withdraw"]), trans("FSW_04", 3).map((t) => t.action));
    check("FSW_04: rollback supersede row says rolled back", /Rolled back/.test(trans("FSW_04", 3).find((t) => t.action === "supersede")?.comment ?? ""));
    check("FSW_04: #3 superseded_by points at #2", f[2].superseded_by_snapshot_id === f[1].id);
    check("FSW_04: v1 lacks and v2 has the uptime check", !/OBCUptime/.test(out.codes.find((c) => c.path === f[0].code_path)!.text) && /OBCUptime/.test(out.codes.find((c) => c.path === f[1].code_path)!.text));
  }
  {
    // review failure with line comments then a fixed snapshot
    const f = snaps("FSW_55");
    check("FSW_55: #1 review_failed, #2 approved", f[0].state === "review_failed" && f[1].state === "approved");
    const lc = out.comments.filter((c) => c.snapshot_id === f[0].id);
    check("FSW_55: line comments on the failed snapshot (some resolved, some not)", lc.filter((c) => c.line).length >= 2 && lc.some((c) => c.resolved_at) && lc.some((c) => !c.resolved_at), lc.map((c) => [c.line, !!c.resolved_at]));
    check("FSW_55: failed snapshot's comment is on the SBT_2 branch line", lc.some((c) => c.line && out.codes.find((x) => x.path === f[0].code_path)!.text.split("\n")[c.line - 1].includes("SBandSbt1TxActvBrt") && c.line > 25));
    check("FSW_55: #2 forked from #1", f[1].parent_snapshot_id === f[0].id);
  }
  {
    // test failure, retest, pass
    const seqn = trans("FSW_40", 1).map((t) => t.action);
    check("FSW_40: test_fail -> retest -> test_pass", /test_fail,retest,test_pass/.test(seqn.join(",")), seqn);
    const tr = out.tests.filter((t) => t.snapshot_id === snap("FSW_40", 1).id);
    check("FSW_40: failed + passed test cases with runs", tr.some((t) => t.result === "fail" && t.run_id) && tr.filter((t) => t.result === "pass" && t.run_id).length >= 2, tr.map((t) => t.result));
    const ev = trans("FSW_40", 1).find((t) => t.action === "test_fail")!.evidence as { test_record_ids?: string[]; run_ids?: string[] };
    check("FSW_40: test_fail transition carries evidence", (ev.test_record_ids?.length ?? 0) === 1 && (ev.run_ids?.length ?? 0) === 1, ev);
  }
  {
    // approval refusal + send back
    const seqn = trans("FSW_45", 1).map((t) => t.action);
    check("FSW_45: refuse -> send_back, now in test", /refuse,send_back$/.test(seqn.join(",")) && snap("FSW_45", 1).state === "test_in_progress", seqn);
    check("FSW_45: refusal has a reason", (trans("FSW_45", 1).find((t) => t.action === "refuse")?.comment ?? "").length > 40);
    check("FSW_45: has an unresolved review comment", out.comments.some((c) => c.snapshot_id === snap("FSW_45", 1).id && !c.resolved_at));
  }
  {
    // retire / restore
    const r = proc("EPS_313")!;
    check("EPS_313: retired with a reason and still has an approved snapshot", !!r.retired_at && !!r.retired_reason && snaps("EPS_313")[0].state === "approved" && r.active_snapshot_id === snaps("EPS_313")[0].id);
    const kinds = out.events.filter((e) => e.procedure_id === proc("EPS_147")!.id).map((e) => e.kind);
    check("EPS_147: created, retired, restored (past round trip), active now", kinds.join(",") === "created,retired,restored" && !proc("EPS_147")!.retired_at, kinds);
  }
  {
    // never approved
    const never = out.procedures.filter((p) => !out.transitions.some((t) => t.procedure_id === p.id && t.action === "approve"));
    check("at least one procedure never approved", never.length >= 1, never.map((p) => p.name));
    const pay = snaps("PAY_251");
    check("PAY_251: never approved: review_failed #1 + working copy #2", pay[0].state === "review_failed" && pay[1].state === "in_progress" && !proc("PAY_251")!.active_snapshot_id);
  }
  {
    // staleness
    const rev = out.snapshots.filter((s) => s.state === "ready_for_review").map((s) => ({ s, d: days(out.transitions.filter((t) => t.snapshot_id === s.id).at(-1)!.created_at) }));
    check(`a snapshot has sat in ready_for_review ~9 days (> ${STALE_AFTER_DAYS})`, rev.some((r) => r.d > 8.5 && r.d < 9.6), rev.map((r) => r.d.toFixed(1)));
    check("others in review are fresh", rev.filter((r) => r.d < STALE_AFTER_DAYS).length >= 2, rev.map((r) => r.d.toFixed(1)));
    const d = lastChange("SYS_02", 2);
    check("SYS_02 #2 has sat in test_in_progress ~6 days", snap("SYS_02", 2).state === "test_in_progress" && d > 5.5 && d < 6.6, d);
  }
  {
    // separation of duties exercised: author who is also a reviewer was reviewed by someone else
    const thm = snap("THM_117", 1);
    check("THM_117: author Meera reviewed by Dev (not herself)", thm.author === personaEmail("meera") && trans("THM_117", 1).find((t) => t.action === "review_pass")?.actor === personaEmail("dev"));
  }

  section("evidence");
  check("test records of every result type", ["pass", "fail", "blocked"].every((r) => out.tests.some((t) => t.result === r)));
  check("review comments resolved and unresolved", out.comments.some((c) => c.resolved_at) && out.comments.some((c) => !c.resolved_at));
  check("general (no line) and line comments", out.comments.some((c) => c.line === null) && out.comments.some((c) => c.line !== null));
  check("runs stored with events", out.runs.length >= 20 && out.runs.every((r) => r.events.length >= 3), out.runs.map((r) => r.events.length).sort((a, b) => a - b).slice(0, 5));
  check("runs have completed and non-completed outcomes", new Set(out.runs.map((r) => r.outcome)).size >= 2, [...new Set(out.runs.map((r) => r.outcome))]);
  check("run events carry t/wall and end with done", out.runs.every((r) => { const l = r.events.at(-1) as { type: string; t: number; wall: number }; return l.type === "done" && typeof l.t === "number" && typeof l.wall === "number"; }));
  check("run summaries filled", out.runs.every((r) => typeof r.summary.commands === "number" && typeof r.summary.virtualSeconds === "number"));
  const bigRun = Math.max(...out.runs.map((r) => JSON.stringify(r.events).length));
  check("largest run events < 400 KB", bigRun < 400_000, bigRun);

  /* ---------------------------------------------------------------------------------------------- queues */
  section("persona queues");
  const queues: Record<string, string[]> = {};
  const lab = (s: { procedure_id: string; number: number; state: string }) => `${out.procedures.find((p) => p.id === s.procedure_id)!.name.replace(/^FF_AXX_(FCP|CRP|LEOP)_/, "")}#${s.number} (${s.state})`;
  for (const persona of PERSONAS) {
    const q: string[] = [];
    for (const s of out.snapshots) {
      const retired = !!out.procedures.find((p) => p.id === s.procedure_id)!.retired_at;
      if (retired) continue;
      const role = persona.roles;
      if (role.includes("reviewer") && QUEUE_STATES.reviewer.includes(s.state) && s.author !== persona.email) q.push(`review ${lab(s)}`);
      if (role.includes("tester") && QUEUE_STATES.tester.includes(s.state)) q.push(`test ${lab(s)}`);
      if (role.includes("approver") && QUEUE_STATES.approver.includes(s.state)) q.push(`approve ${lab(s)}`);
      if (role.includes("author") && s.author === persona.email && QUEUE_STATES.author.includes(s.state)) q.push(`yours ${lab(s)}`);
    }
    queues[persona.displayName] = q;
    console.log(`    ${persona.displayName.padEnd(12)} ${q.length}  ${q.join("; ")}`);
  }
  check("Meera has 2-3 reviews", queues["Meera Iyer"].filter((x) => x.startsWith("review")).length >= 2 && queues["Meera Iyer"].filter((x) => x.startsWith("review")).length <= 3);
  check("Kabir has 2 tests", queues["Kabir Singh"].filter((x) => x.startsWith("test")).length === 2);
  check("Nisha has 2 approvals", queues["Nisha Verma"].filter((x) => x.startsWith("approve")).length === 2);
  check("Asha has working copies and a failed snapshot to fix", queues["Asha Rao"].some((x) => x.includes("in_progress")) && queues["Asha Rao"].some((x) => x.includes("review_failed")));
  check("Rohan has working copies", queues["Rohan Mehta"].filter((x) => x.includes("in_progress")).length >= 2);

  /* ---------------------------------------------------------------------------------------------- summary */
  const byState: Record<string, number> = {};
  for (const s of out.snapshots) byState[s.state] = (byState[s.state] ?? 0) + 1;
  console.log(`\n    procedures ${out.procedures.length}, snapshots ${out.snapshots.length} ${JSON.stringify(byState)}`);
  console.log(`    transitions ${out.transitions.length}, events ${out.events.length}, comments ${out.comments.length}, tests ${out.tests.length}, runs ${out.runs.length}, code objects ${out.codes.length}`);
  console.log(`\n${passed} checks passed, ${failures.length} failed (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  for (const f of failures) console.log(" - " + f.slice(0, 600));
  process.exit(failures.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
