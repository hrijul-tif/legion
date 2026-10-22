/**
 * Replays the seed manifest into rows. Pure apart from running procedures on the mock (via the harness) and reading
 * code files. The state machine mirrors public.transition_snapshot / submit_snapshot / set_procedure_retired in
 * supabase/migrations/*_core_schema.sql, including the system `supersede` rows and their `related_snapshot_id`.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ACTIONS, hasRole, type ManualAction, type MosRole } from "../lib/lifecycle";
import { PERSONAS } from "../lib/personas";
import { ROOT, compactEvents, summarizeRun, type Harness } from "./harness";
import type {
  Ago,
  CodeObject,
  CommentOut,
  PersonaKey,
  ProcedureEventOut,
  ProcedureOut,
  ProcedureSeed,
  ReplayOutput,
  RunOut,
  RunSpec,
  SnapshotOut,
  Step,
  TestOut,
  TransitionOut,
} from "./types";

export const SEED_DIR = join(ROOT, "seed");

export function personaEmail(key: PersonaKey): string {
  const p = PERSONAS.find((x) => x.email.startsWith(`${key}.`));
  if (!p) throw new Error(`Unknown persona ${key}`);
  return p.email;
}
function personaRoles(email: string): MosRole[] {
  const p = PERSONAS.find((x) => x.email === email);
  if (!p) throw new Error(`Unknown persona ${email}`);
  return p.roles;
}

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** Deterministic uuid so re-seeding keeps every URL stable. */
export function uid(...parts: (string | number)[]): string {
  const h = createHash("sha1").update(["mos-seed", ...parts].join("|")).digest("hex");
  const variant = ((parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, "0");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${variant}${h.slice(18, 20)}-${h.slice(20, 32)}`;
}

export function parseAgo(ago: Ago): number {
  let ms = 0;
  let matched = 0;
  for (const m of ago.matchAll(/(\d+)\s*([dhm])/g)) {
    const n = Number(m[1]);
    ms += n * (m[2] === "d" ? 86_400_000 : m[2] === "h" ? 3_600_000 : 60_000);
    matched++;
  }
  if (!matched) throw new Error(`Bad ago "${ago}"`);
  return ms;
}

export function codeFile(proc: ProcedureSeed, ref: string): string {
  return join(SEED_DIR, ref === "main" ? proc.file : `procedures/ff/_versions/${proc.name}.${ref}.py`);
}
export function readCode(proc: ProcedureSeed, ref: string): string {
  return readFileSync(codeFile(proc, ref), "utf8");
}

interface Snap {
  row: SnapshotOut;
  code: string;
  author: string;
  reviewer: string | null;
  testIds: string[];
  runIds: string[];
}

const SELF_ACTIONS = new Set(["review_pass", "review_fail", "test_pass", "test_fail", "approve", "refuse"]);

export interface ReplayOptions {
  now: Date;
  harness: Harness;
}

export function replay(procs: ProcedureSeed[], { now, harness }: ReplayOptions): ReplayOutput {
  const out: ReplayOutput = { now: now.toISOString(), procedures: [], snapshots: [], transitions: [], events: [], comments: [], tests: [], runs: [], codes: [] };
  const seqTransitions: { t: number; seq: number; row: TransitionOut }[] = [];
  const seqEvents: { t: number; seq: number; row: ProcedureEventOut }[] = [];
  let seq = 0;
  const at = (ago: Ago) => new Date(now.getTime() - parseAgo(ago));

  for (const proc of procs) {
    const where = (i: number, step: Step) => `${proc.name} step ${i + 1} (${step.op}${"n" in step ? ` #${step.n}` : ""})`;
    let procRow: ProcedureOut | null = null;
    const snaps = new Map<number, Snap>();
    let lastT = -Infinity;

    const snapOf = (n: number, label: string): Snap => {
      const s = snaps.get(n);
      if (!s) throw new Error(`${label}: snapshot #${n} does not exist yet`);
      return s;
    };
    const logTransition = (s: Snap, action: string, to: SnapshotOut["state"], actor: string, comment: string | null, t: Date, related: string | null = null, evidence: Record<string, unknown> = {}) => {
      const row: TransitionOut = {
        snapshot_id: s.row.id,
        procedure_id: s.row.procedure_id,
        action,
        from_state: action === "create" ? null : s.row.state,
        to_state: to,
        actor,
        comment: comment && comment.trim() ? comment.trim() : null,
        related_snapshot_id: related,
        evidence,
        created_at: t.toISOString(),
      };
      seqTransitions.push({ t: t.getTime(), seq: seq++, row });
    };
    const addRun = (s: Snap, who: string, spec: RunSpec | undefined, t: Date): RunOut => {
      const args = { ...proc.defaultArgs, ...(spec?.args ?? {}) };
      const WARP = 100;
      const res = harness.run(s.code, {
        args,
        faults: spec?.faults,
        answers: spec?.answers,
        telemetry: spec?.telemetry,
        startedAtMs: t.getTime(),
        displayWarp: WARP,
      });
      const summary = summarizeRun(res.events);
      const idx = out.runs.length;
      const run: RunOut = {
        id: uid("run", proc.name, s.row.number, idx),
        snapshot_id: s.row.id,
        target: "mock",
        code_sha256: sha256(s.code),
        args,
        options: { warp: WARP, faults: spec?.faults ?? [], ...(spec?.telemetry ? { telemetry: spec.telemetry } : {}) },
        outcome: res.outcome,
        error: res.error,
        events: compactEvents(res.events),
        summary,
        started_by: who,
        started_at: t.toISOString(),
        ended_at: new Date(t.getTime() + Math.max(1000, res.wallMs)).toISOString(),
      };
      out.runs.push(run);
      s.runIds.push(run.id);
      return run;
    };

    proc.history.forEach((step, i) => {
      const label = where(i, step);
      const stepAgo = step.ago;
      const t = at(stepAgo);
      if (t.getTime() < lastT) throw new Error(`${label}: happens before the previous step (ago ${stepAgo})`);
      lastT = t.getTime();
      if (t.getTime() > now.getTime()) throw new Error(`${label}: in the future`);
      if (procRow?.retired_at && step.op !== "restore") {
        if (step.op === "retire") throw new Error(`${label}: procedure already retired`);
        if (["create", "submit", ...Object.keys(ACTIONS)].includes(step.op)) throw new Error(`${label}: procedure is retired`);
      }

      switch (step.op) {
        case "create": {
          const actor = personaEmail(step.by);
          if (!hasRole(personaRoles(actor), "author")) throw new Error(`${label}: ${actor} is not an author`);
          if (!procRow) {
            procRow = {
              id: uid("procedure", proc.name),
              name: proc.name,
              description: proc.description,
              mission: proc.mission,
              folder: proc.folder,
              active_snapshot_id: null,
              snapshot_seq: 0,
              retired_at: null,
              retired_by: null,
              retired_reason: null,
              created_by: actor,
              created_at: t.toISOString(),
            };
            out.procedures.push(procRow);
            seqEvents.push({ t: t.getTime(), seq: seq++, row: { procedure_id: procRow.id, kind: "created", actor, reason: null, detail: {}, created_at: t.toISOString() } });
          }
          const parent = step.from === undefined ? null : snapOf(step.from, label);
          const number = ++procRow.snapshot_seq;
          const id = uid("snapshot", proc.name, number);
          const row: SnapshotOut = {
            id,
            procedure_id: procRow.id,
            number,
            author: actor,
            parent_snapshot_id: parent?.row.id ?? null,
            state: "in_progress",
            draft_path: `drafts/${id}.py`,
            code_path: null,
            code_sha256: null,
            code_bytes: null,
            entrypoint: null,
            signature: null,
            summary: null,
            submitted_at: null,
            superseded_by_snapshot_id: null,
            created_at: t.toISOString(),
            updated_at: t.toISOString(),
          };
          const s: Snap = { row, code: readCode(proc, step.code), author: actor, reviewer: null, testIds: [], runIds: [] };
          snaps.set(number, s);
          out.snapshots.push(row);
          logTransition(s, "create", "in_progress", actor, null, t, parent?.row.id ?? null);
          break;
        }

        case "submit": {
          const s = snapOf(step.n, label);
          if (s.row.state !== "in_progress") throw new Error(`${label}: #${step.n} is ${s.row.state}`);
          if (!step.summary.trim()) throw new Error(`${label}: summary required`);
          const lint = harness.lint(s.code);
          const errors = lint.diagnostics.filter((d) => d.severity === "error");
          if (errors.length) throw new Error(`${label}: MOS checker errors: ${errors.map((e) => `${e.code} line ${e.startLine}: ${e.message}`).join("; ")}`);
          const signature = harness.signature(s.code);
          const sha = sha256(s.code);
          logTransition(s, "submit", "ready_for_review", s.author, step.summary, t);
          Object.assign(s.row, {
            state: "ready_for_review",
            code_path: `frozen/${s.row.procedure_id}/${s.row.id}-${sha}.py`,
            code_sha256: sha,
            code_bytes: Buffer.byteLength(s.code, "utf8"),
            entrypoint: signature.entrypoint,
            signature,
            summary: step.summary.trim(),
            submitted_at: t.toISOString(),
            updated_at: t.toISOString(),
          } satisfies Partial<SnapshotOut>);
          break;
        }

        case "review_pass":
        case "review_fail":
        case "test_pass":
        case "test_fail":
        case "retest":
        case "approve":
        case "refuse":
        case "send_back":
        case "reactivate":
        case "withdraw": {
          const meta = ACTIONS[step.op as ManualAction];
          const actor = personaEmail(step.by);
          const s = snapOf(step.n, label);
          const roles = personaRoles(actor);
          const roleOk = hasRole(roles, meta.role) || (step.op === "retest" && actor === s.author);
          if (!roleOk) throw new Error(`${label}: ${actor} lacks the ${meta.role} role`);
          if (!meta.from.includes(s.row.state)) throw new Error(`${label}: #${step.n} is ${s.row.state}, expected ${meta.from.join(" or ")}`);
          if (meta.needsComment && !step.comment?.trim()) throw new Error(`${label}: comment required`);
          if (SELF_ACTIONS.has(step.op) && actor === s.author) throw new Error(`${label}: ${actor} cannot ${step.op} their own snapshot`);
          if ((step.op === "approve" || step.op === "refuse") && s.reviewer === actor) throw new Error(`${label}: ${actor} reviewed this snapshot and cannot approve it`);

          let prev: Snap | null = null;
          if (meta.to === "approved") {
            prev = [...snaps.values()].find((x) => x.row.state === "approved" && x !== s) ?? null;
            if (prev) {
              logTransition(
                prev,
                "supersede",
                "superseded",
                actor,
                step.op === "reactivate" ? `Rolled back: #${s.row.number} reactivated in place of #${prev.row.number}` : `Superseded by #${s.row.number}`,
                t,
                s.row.id,
              );
              Object.assign(prev.row, { state: "superseded", superseded_by_snapshot_id: s.row.id, updated_at: t.toISOString() });
            }
          }
          const evidence = step.op === "test_pass" || step.op === "test_fail" ? { test_record_ids: [...s.testIds], run_ids: [...s.runIds] } : {};
          logTransition(s, step.op, meta.to, actor, step.comment ?? null, t, prev?.row.id ?? null, evidence);
          s.row.state = meta.to;
          s.row.updated_at = t.toISOString();
          if (meta.to === "approved") {
            s.row.superseded_by_snapshot_id = null;
            procRow!.active_snapshot_id = s.row.id;
          }
          if (step.op === "review_pass") s.reviewer = actor;
          break;
        }

        case "comment": {
          const s = snapOf(step.n, label);
          if (s.row.state === "in_progress") throw new Error(`${label}: comments need a submitted snapshot`);
          const author = personaEmail(step.by);
          let line: number | null = null;
          if (step.anchor) {
            const lines = s.code.split("\n");
            let seen = 0;
            const want = step.anchor.nth ?? 1;
            for (let k = 0; k < lines.length; k++) {
              if (lines[k].includes(step.anchor.text) && ++seen === want) {
                line = k + 1;
                break;
              }
            }
            if (line === null) throw new Error(`${label}: anchor "${step.anchor.text}" (#${want}) not found in #${step.n}`);
          }
          let resolved_at: string | null = null;
          let resolved_by: string | null = null;
          if (step.resolved) {
            resolved_by = personaEmail(step.resolved.by);
            const rt = at(step.resolved.ago);
            if (rt.getTime() < t.getTime()) throw new Error(`${label}: resolved before it was written`);
            if (!(resolved_by === author || hasRole(personaRoles(resolved_by), "reviewer"))) throw new Error(`${label}: ${resolved_by} may not resolve this comment`);
            resolved_at = rt.toISOString();
          }
          const c: CommentOut = {
            id: uid("comment", proc.name, step.n, out.comments.length),
            snapshot_id: s.row.id,
            author,
            line,
            body: step.body,
            resolved_at,
            resolved_by,
            created_at: t.toISOString(),
          };
          out.comments.push(c);
          break;
        }

        case "test": {
          const s = snapOf(step.n, label);
          const tester = personaEmail(step.by);
          if (!hasRole(personaRoles(tester), "tester")) throw new Error(`${label}: ${tester} is not a tester`);
          if (s.row.state !== "test_in_progress") throw new Error(`${label}: #${step.n} is ${s.row.state}; test cases can only be recorded while testing`);
          let runId: string | null = null;
          if (step.run) {
            const run = addRun(s, tester, step.run, new Date(t.getTime() - 120_000));
            runId = run.id;
          }
          const rec: TestOut = {
            id: uid("test", proc.name, step.n, out.tests.length),
            snapshot_id: s.row.id,
            tester,
            name: step.name,
            result: step.result,
            notes: step.notes,
            run_id: runId,
            created_at: t.toISOString(),
          };
          out.tests.push(rec);
          s.testIds.push(rec.id);
          break;
        }

        case "run": {
          const s = snapOf(step.n, label);
          addRun(s, personaEmail(step.by), step.run, t);
          break;
        }

        case "retire":
        case "restore": {
          const actor = personaEmail(step.by);
          if (!hasRole(personaRoles(actor), "approver")) throw new Error(`${label}: ${actor} is not an approver`);
          if (!step.reason.trim()) throw new Error(`${label}: reason required`);
          if (!procRow) throw new Error(`${label}: no procedure yet`);
          if (step.op === "retire") {
            if (procRow.retired_at) throw new Error(`${label}: already retired`);
            Object.assign(procRow, { retired_at: t.toISOString(), retired_by: actor, retired_reason: step.reason.trim() });
          } else {
            if (!procRow.retired_at) throw new Error(`${label}: not retired`);
            Object.assign(procRow, { retired_at: null, retired_by: null, retired_reason: null });
          }
          seqEvents.push({
            t: t.getTime(),
            seq: seq++,
            row: { procedure_id: procRow.id, kind: step.op === "retire" ? "retired" : "restored", actor, reason: step.reason.trim(), detail: { active_snapshot_id: procRow.active_snapshot_id }, created_at: t.toISOString() },
          });
          break;
        }
      }
    });

    // code objects: working copies live in drafts/, everything else is frozen
    for (const s of snaps.values()) {
      if (s.row.state === "in_progress") out.codes.push({ path: s.row.draft_path, text: s.code, kind: "draft" } satisfies CodeObject);
      else out.codes.push({ path: s.row.code_path!, text: s.code, kind: "frozen" });
    }
  }

  const byTime = <T extends { t: number; seq: number }>(a: T, b: T) => a.t - b.t || a.seq - b.seq;
  out.transitions = seqTransitions.sort(byTime).map((x) => x.row);
  out.events = seqEvents.sort(byTime).map((x) => x.row);
  return out;
}
