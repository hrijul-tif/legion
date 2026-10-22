/**
 * Offline checks of replayed seed data: the same invariants as public.verify_lifecycle_integrity() plus the table
 * constraints, separation of duties and storage-path rules the database / app rely on. Returns human-readable problems.
 */
import { sha256 } from "./replay";
import type { ReplayOutput } from "./types";

export function validateOutput(out: ReplayOutput): string[] {
  const problems: string[] = [];
  const now = Date.parse(out.now);
  const snapById = new Map(out.snapshots.map((s) => [s.id, s]));
  const procById = new Map(out.procedures.map((p) => [p.id, p]));
  const codeByPath = new Map(out.codes.map((c) => [c.path, c]));
  const label = (id: string) => {
    const s = snapById.get(id);
    return s ? `${procById.get(s.procedure_id)?.name}#${s.number}` : id;
  };

  const names = new Set<string>();
  for (const p of out.procedures) {
    if (names.has(p.name.toLowerCase())) problems.push(`duplicate procedure name ${p.name}`);
    names.add(p.name.toLowerCase());
    if (p.name.length < 3 || p.name.length > 120) problems.push(`procedure name length ${p.name}`);
    const mine = out.snapshots.filter((s) => s.procedure_id === p.id);
    const approved = mine.filter((s) => s.state === "approved");
    if (approved.length > 1) problems.push(`${p.name}: ${approved.length} approved snapshots`);
    if (p.active_snapshot_id) {
      const a = snapById.get(p.active_snapshot_id);
      if (!a || a.state !== "approved" || a.procedure_id !== p.id) problems.push(`procedure ${p.name} points at ${p.active_snapshot_id} which is not approved`);
    } else if (approved.length) problems.push(`procedure ${p.name} has an approved snapshot but no active pointer`);
    if (p.snapshot_seq !== Math.max(0, ...mine.map((s) => s.number))) problems.push(`${p.name}: snapshot_seq ${p.snapshot_seq} != max number`);
    const numbers = mine.map((s) => s.number).sort((a, b) => a - b);
    if (numbers.some((n, i) => n !== i + 1)) problems.push(`${p.name}: snapshot numbers not contiguous: ${numbers.join(",")}`);
  }

  // transitions per snapshot: first is `create`, chain is contiguous, last matches the state
  const bySnap = new Map<string, typeof out.transitions>();
  for (const t of out.transitions) {
    if (!bySnap.has(t.snapshot_id)) bySnap.set(t.snapshot_id, []);
    bySnap.get(t.snapshot_id)!.push(t);
    if (Date.parse(t.created_at) > now) problems.push(`${label(t.snapshot_id)}: transition in the future`);
  }
  for (const s of out.snapshots) {
    const ts = bySnap.get(s.id) ?? [];
    if (!ts.length || ts[0].action !== "create" || ts[0].from_state !== null) problems.push(`${label(s.id)}: does not start with a create transition`);
    ts.forEach((t, i) => {
      if (i > 0 && t.from_state !== ts[i - 1].to_state) problems.push(`${label(s.id)}: transition ${t.action} from ${t.from_state} but previous ended in ${ts[i - 1].to_state}`);
    });
    const last = ts[ts.length - 1];
    if (last && last.to_state !== s.state) problems.push(`snapshot ${label(s.id)} state ${s.state} does not match its last transition ${last.to_state}`);
    if (Date.parse(s.updated_at) < Date.parse(s.created_at)) problems.push(`${label(s.id)}: updated before created`);
    if (ts[0] && Date.parse(ts[0].created_at) !== Date.parse(s.created_at)) problems.push(`${label(s.id)}: create transition time differs from created_at`);

    // storage + signature rules
    if (s.state === "in_progress") {
      if (s.code_path || s.code_sha256) problems.push(`${label(s.id)}: working copy has frozen code`);
      const c = codeByPath.get(s.draft_path);
      if (!c || c.kind !== "draft") problems.push(`${label(s.id)}: draft object missing`);
    } else {
      if (!s.code_path || !s.code_sha256 || !/^[0-9a-f]{64}$/.test(s.code_sha256)) problems.push(`${label(s.id)}: frozen snapshot without code`);
      else {
        if (s.code_path !== `frozen/${s.procedure_id}/${s.id}-${s.code_sha256}.py`) problems.push(`${label(s.id)}: unexpected frozen path`);
        const c = codeByPath.get(s.code_path);
        if (!c) problems.push(`${label(s.id)}: frozen object missing`);
        else {
          if (sha256(c.text) !== s.code_sha256) problems.push(`${label(s.id)}: sha256 mismatch`);
          if (Buffer.byteLength(c.text, "utf8") !== s.code_bytes) problems.push(`${label(s.id)}: code_bytes mismatch`);
        }
      }
      if (!s.signature || s.signature.entrypoint !== s.entrypoint) problems.push(`${label(s.id)}: signature/entrypoint missing`);
      if (!s.summary) problems.push(`${label(s.id)}: submitted without summary`);
      if (!s.submitted_at) problems.push(`${label(s.id)}: submitted_at missing`);
    }
    if (s.state === "superseded" && !s.superseded_by_snapshot_id) problems.push(`${label(s.id)}: superseded without superseded_by`);
    if ((s.state === "approved") && s.superseded_by_snapshot_id) problems.push(`${label(s.id)}: approved but has superseded_by`);

    // separation of duties
    const actorsOf = (a: string) => ts.filter((t) => t.action === a).map((t) => t.actor);
    for (const a of ["review_pass", "review_fail", "test_pass", "test_fail", "approve", "refuse"])
      if (actorsOf(a).includes(s.author)) problems.push(`${label(s.id)}: author performed ${a} on their own snapshot`);
    for (const a of ["approve", "refuse"])
      for (const who of actorsOf(a)) if (actorsOf("review_pass").includes(who)) problems.push(`${label(s.id)}: reviewer ${who} also performed ${a}`);
  }

  // supersede rows are paired with the approve/reactivate that caused them
  for (const t of out.transitions.filter((x) => x.action === "supersede")) {
    const cause = out.transitions.find((x) => x.snapshot_id === t.related_snapshot_id && (x.action === "approve" || x.action === "reactivate") && x.created_at === t.created_at);
    if (!cause) problems.push(`${label(t.snapshot_id)}: supersede row without a matching approve/reactivate`);
    else if (cause.related_snapshot_id !== t.snapshot_id) problems.push(`${label(cause.snapshot_id)}: ${cause.action} does not point at the snapshot it superseded`);
  }

  for (const c of out.comments) {
    const s = snapById.get(c.snapshot_id);
    if (!s) problems.push(`comment ${c.id}: no snapshot`);
    else if (s.state === "in_progress") problems.push(`comment on working copy ${label(c.snapshot_id)}`);
    if (c.line !== null) {
      const code = codeByPath.get(s!.code_path ?? s!.draft_path);
      if (!code || c.line < 1 || c.line > code.text.split("\n").length) problems.push(`comment line ${c.line} out of range on ${label(c.snapshot_id)}`);
    }
    if (!c.body) problems.push("empty comment");
  }
  const runIds = new Set(out.runs.map((r) => r.id));
  for (const t of out.tests) if (t.run_id && !runIds.has(t.run_id)) problems.push(`test ${t.id}: dangling run`);
  for (const r of out.runs) {
    const s = snapById.get(r.snapshot_id);
    const code = s && codeByPath.get(s.code_path ?? s.draft_path);
    if (!code || sha256(code.text) !== r.code_sha256) problems.push(`run ${r.id}: code hash does not match ${label(r.snapshot_id)}`);
    if (Date.parse(r.started_at) > now) problems.push(`run ${r.id}: started in the future`);
  }
  return problems;
}
