"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  Loader2,
  MinusCircle,
  Play,
  Send,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { submitSnapshot } from "@/app/actions/lifecycle";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { DiffViewer } from "@/components/mos/code/diff-viewer";
import { lineDiffStats } from "@/components/mos/code/diff-stats";
import { cn } from "@/lib/utils";
import { shortHash } from "@/lib/lifecycle";
import { sha256Hex } from "@/lib/ide/hash";
import {
  runPreflight,
  type PreflightResult,
  type Problem,
} from "@/lib/ide/monaco-ide";
import { signatureOf } from "@/lib/ide/args";
import { IDE_KEYS, removeKey } from "@/lib/ide/storage";
import type { IdeCodeRef, IdeSnapshot } from "@/lib/ide/types";
import type { Mission } from "@/lib/data/types";
import type { EditorApi } from "./editor-pane";
import { useRunSession } from "./run-session";
import "./ide.css";

type Status = "pass" | "fail" | "warn" | "info" | "pending";

interface Check {
  id: string;
  label: string;
  status: Status;
  detail?: string;
  items?: Problem[];
  action?: ReactNode;
}

const STATUS_ICON: Record<Status, ReactNode> = {
  pass: <CheckCircle2 className="size-4 text-tone-success" />,
  fail: <XCircle className="size-4 text-tone-danger" />,
  warn: <AlertTriangle className="size-4 text-tone-warn" />,
  info: <MinusCircle className="size-4 text-muted-foreground" />,
  pending: <Loader2 className="size-4 animate-spin text-muted-foreground" />,
};

function isSyntax(p: Problem) {
  return (
    p.code === "invalid-syntax" ||
    p.code === "MOS000" ||
    (p.owner === "ruff" && p.code.startsWith("E9"))
  );
}

function buildChecks(
  pre: PreflightResult | null,
  sha: string | null,
  last: { sha: string; outcome: string } | null,
  onRunNow: () => void,
): Check[] {
  if (!pre)
    return ["syntax", "mos", "mdb", "ruff", "dry"].map((id) => ({
      id,
      label: id,
      status: "pending" as Status,
    }));
  const probs = pre.problems;
  const syntax = probs.filter(isSyntax);
  const mos = probs.filter((p) => p.owner === "mos" && !isSyntax(p));
  const mdb = probs.filter((p) => p.owner === "mos-catalog");
  const ruff = probs.filter((p) => p.owner === "ruff" && !isSyntax(p));
  const blocking = (list: Problem[]) =>
    list.filter((p) => p.severity === "error");
  const rest = (list: Problem[]) => list.filter((p) => p.severity !== "error");

  const out: Check[] = [];
  out.push({
    id: "syntax",
    label: "Syntax",
    status: syntax.length ? "fail" : pre.checked ? "pass" : "warn",
    detail: syntax.length
      ? "The file does not parse"
      : pre.checked
        ? "Parses cleanly"
        : "The language service did not answer; syntax could not be verified",
    items: syntax,
  });
  out.push({
    id: "entry",
    label: "Entry function",
    status: pre.entry ? "pass" : "fail",
    detail: pre.entry
      ? `${pre.entry.entrypoint}(${pre.entry.params.length} argument${pre.entry.params.length === 1 ? "" : "s"})`
      : "No public entry function found",
  });
  out.push({
    id: "mos",
    label: "MOS rules",
    status: blocking(mos).length ? "fail" : rest(mos).length ? "warn" : "pass",
    detail: blocking(mos).length
      ? `${blocking(mos).length} error${blocking(mos).length === 1 ? "" : "s"} must be fixed`
      : rest(mos).length
        ? `${rest(mos).length} warning${rest(mos).length === 1 ? "" : "s"}`
        : "All rules pass",
    items: mos,
  });
  out.push({
    id: "mdb",
    label: "MDB usage",
    status: blocking(mdb).length ? "fail" : rest(mdb).length ? "warn" : "pass",
    detail: blocking(mdb).length
      ? `${blocking(mdb).length} unknown or invalid command/parameter use${blocking(mdb).length === 1 ? "" : "s"}`
      : rest(mdb).length
        ? `${rest(mdb).length} warning${rest(mdb).length === 1 ? "" : "s"}`
        : "Commands, parameters and enums match the catalog",
    items: mdb,
  });
  out.push({
    id: "ruff",
    label: "Ruff",
    status: ruff.length ? "warn" : "pass",
    detail: ruff.length
      ? `${ruff.length} finding${ruff.length === 1 ? "" : "s"} (not blocking)`
      : "No findings",
    items: ruff,
  });
  const same = last && sha && last.sha === sha;
  out.push({
    id: "dry",
    label: "Dry run",
    status:
      same && last.outcome === "completed" ? "pass" : same ? "warn" : "info",
    detail: same
      ? last.outcome === "completed"
        ? "Completed against the mock spacecraft on exactly this content"
        : `Last run on this exact content ended “${last.outcome}”`
      : "Not run on this exact content",
    action: !(same && last.outcome === "completed") ? (
      <Button size="xs" variant="outline" onClick={onRunNow}>
        <Play className="fill-current" /> Run now
      </Button>
    ) : undefined,
  });
  return out;
}

function CheckRow({ c }: { c: Check }) {
  const [open, setOpen] = useState(false);
  const items = c.items ?? [];
  return (
    <li className="px-3 py-2">
      <div className="flex items-center gap-2.5">
        {STATUS_ICON[c.status]}
        <span className="w-28 shrink-0 text-xs font-medium">{c.label}</span>
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-xs",
            c.status === "fail" ? "text-tone-danger" : "text-muted-foreground",
          )}
        >
          {c.detail ?? ""}
        </span>
        {c.action}
        {items.length > 0 && (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground hover:text-foreground"
            aria-expanded={open}
          >
            {items.length}{" "}
            <ChevronDown
              className={cn(
                "size-3 transition-transform",
                open && "rotate-180",
              )}
            />
          </button>
        )}
      </div>
      {open && items.length > 0 && (
        <ul className="mt-1.5 ml-6.5 space-y-1 border-l pl-3">
          {items.slice(0, 20).map((p) => (
            <li key={p.key} className="text-[11px] leading-snug">
              <span className="font-mono text-muted-foreground">
                {p.line}:{p.column} {p.code}
              </span>{" "}
              <span
                className={
                  p.severity === "error" ? "text-tone-danger" : undefined
                }
              >
                {p.message}
              </span>
            </li>
          ))}
          {items.length > 20 && (
            <li className="text-[11px] text-muted-foreground">
              + {items.length - 20} more (see Problems)
            </li>
          )}
        </ul>
      )}
    </li>
  );
}

export interface SubmitDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  api: EditorApi | null;
  mission: Mission;
  snapshot: IdeSnapshot;
  parent: IdeCodeRef | null;
  flush(): Promise<boolean>;
  onRunNow(): void;
  /** called as soon as the server froze the snapshot (before navigation) */
  onSubmitted(): void;
}

export function SubmitDialog({
  open,
  onOpenChange,
  api,
  mission,
  snapshot,
  parent,
  flush,
  onRunNow,
  onSubmitted,
}: SubmitDialogProps) {
  const router = useRouter();
  const session = useRunSession();
  const reduce = useReducedMotion();
  const [pre, setPre] = useState<PreflightResult | null>(null);
  const [sha, setSha] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [summary, setSummary] = useState("");
  const [fork, setFork] = useState(true);
  const [showDiff, setShowDiff] = useState(false);
  const [phase, setPhase] = useState<"form" | "submitting" | "done">("form");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    number: number;
    sha: string;
    forkId: string | null;
    forkNumber: number | null;
    id: string;
  } | null>(null);
  const navTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // pre-flight every time the dialog opens, on exactly what is on screen
  useEffect(() => {
    if (!open || !api || phase !== "form") return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset when the dialog opens
    setPre(null);
    setError(null);
    const text = api.model.getValue();
    setCode(text);
    void Promise.all([
      runPreflight(api.monaco, api.model, mission),
      sha256Hex(text),
    ]).then(([result, hash]) => {
      if (cancelled) return;
      setPre(result);
      setSha(hash);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- phase is read once on open
  }, [open, api, mission]);

  useEffect(
    () => () => {
      if (navTimer.current) clearTimeout(navTimer.current);
    },
    [],
  );

  const checks = useMemo(
    () =>
      buildChecks(pre, sha, session.lastRun, () => {
        onOpenChange(false);
        onRunNow();
      }),
    [pre, sha, session.lastRun, onOpenChange, onRunNow],
  );

  const blocking = checks.filter((c) => c.status === "fail");
  const stats = useMemo(
    () => lineDiffStats(parent?.code ?? "", code),
    [parent, code],
  );
  const entry = pre?.entry ?? null;
  const summaryOk = summary.trim().length >= 3;
  const canSubmit =
    !!pre &&
    blocking.length === 0 &&
    summaryOk &&
    !!entry &&
    phase === "form" &&
    code.trim().length > 0;

  const submit = async () => {
    if (!api || !entry) return;
    setPhase("submitting");
    setError(null);
    try {
      const saved = await flush();
      if (!saved)
        throw new Error(
          "Your latest changes could not be saved. Check your connection and try again.",
        );
      const res = await submitSnapshot({
        snapshotId: snapshot.id,
        summary: summary.trim(),
        signature: signatureOf(entry),
        fork,
      });
      if (!res.ok) throw new Error(res.error);
      if (sha && res.data.sha !== sha)
        toast.warning(
          "The frozen content differs from the editor buffer. Open the snapshot to check it.",
        );
      removeKey(IDE_KEYS.draft(snapshot.id));
      setResult({
        number: res.data.number,
        sha: res.data.sha,
        forkId: res.data.forkId,
        forkNumber: res.data.forkNumber,
        id: res.data.submittedId,
      });
      setPhase("done");
      onSubmitted();
      navTimer.current = setTimeout(() => {
        if (res.data.forkId) {
          toast.success(
            `You're now editing #${res.data.forkNumber} — #${res.data.number} is with reviewers`,
          );
          router.push(`/snapshots/${res.data.forkId}/edit`);
        } else {
          router.push(`/snapshots/${res.data.submittedId}`);
        }
      }, 1700);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("form");
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) =>
        phase === "submitting" ? undefined : onOpenChange(o)
      }
    >
      <DialogContent
        showCloseButton={phase === "form"}
        className="max-h-[92dvh] gap-0 overflow-hidden p-0 sm:max-w-2xl"
      >
        <AnimatePresence mode="wait" initial={false}>
          {phase === "done" && result ? (
            <motion.div
              key="done"
              initial={reduce ? false : { opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex flex-col items-center gap-3 px-8 py-14 text-center"
            >
              <div className="relative flex size-16 items-center justify-center">
                <span className="ide-ring-out absolute inset-0 rounded-full border-2 border-tone-success" />
                <span className="flex size-16 items-center justify-center rounded-full bg-tone-success/12 text-tone-success">
                  <svg
                    viewBox="0 0 24 24"
                    className="size-8"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <path
                      className="ide-check-path"
                      d="M5 12.5l4.5 4.5L19 7.5"
                    />
                  </svg>
                </span>
              </div>
              <DialogTitle className="text-lg">
                Snapshot <span className="font-mono">#{result.number}</span>{" "}
                frozen
              </DialogTitle>
              <DialogDescription className="text-sm">
                <span className="font-mono">
                  sha256 {shortHash(result.sha)}
                </span>{" "}
                · sent to review
              </DialogDescription>
              <p className="text-xs text-muted-foreground">
                {result.forkId
                  ? `Taking you to your new working copy #${result.forkNumber}…`
                  : "Opening the snapshot…"}
              </p>
            </motion.div>
          ) : (
            <motion.div
              key="form"
              initial={false}
              exit={{ opacity: 0 }}
              className="flex max-h-[92dvh] flex-col"
            >
              <DialogHeader className="border-b px-5 py-4">
                <DialogTitle className="flex items-center gap-2 text-base">
                  <Send className="size-4 text-primary" /> Submit working copy{" "}
                  <span className="font-mono">#{snapshot.number}</span> for
                  review
                </DialogTitle>
                <DialogDescription>
                  Submitting freezes this exact content. It can never be edited
                  afterwards; fixes become a new snapshot.
                </DialogDescription>
              </DialogHeader>

              <div className="ide-scroll min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
                <section aria-label="Pre-flight checks">
                  <h3 className="mb-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                    Pre-flight
                  </h3>
                  <ul className="divide-y rounded-lg border bg-card/50">
                    {checks.map((c) => (
                      <CheckRow key={c.id} c={c} />
                    ))}
                  </ul>
                  {blocking.length > 0 && (
                    <p className="mt-1.5 text-xs text-tone-danger">
                      Fix the {blocking.length} failing check
                      {blocking.length === 1 ? "" : "s"} to submit.
                    </p>
                  )}
                </section>

                {entry && (
                  <section aria-label="Entry signature">
                    <h3 className="mb-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                      What operators will fill in
                    </h3>
                    <div className="rounded-lg border bg-muted/30 px-3 py-2 font-mono text-xs">
                      <span className="font-semibold">{entry.entrypoint}</span>
                      <span className="text-muted-foreground">(</span>
                      {entry.params.length === 0 && (
                        <span className="text-muted-foreground">
                          no arguments
                        </span>
                      )}
                      <div className="pl-4">
                        {entry.params.map((p) => (
                          <div key={p.name}>
                            {p.name}
                            <span className="text-muted-foreground">: </span>
                            <span className="text-tone-info">
                              {p.annotation ?? "unannotated"}
                            </span>
                            {p.default !== undefined && (
                              <span className="text-muted-foreground">
                                {" "}
                                = {JSON.stringify(p.default)}
                              </span>
                            )}
                            {p.required ? (
                              <span className="text-tone-danger"> *</span>
                            ) : null}
                          </div>
                        ))}
                      </div>
                      <span className="text-muted-foreground">)</span>
                    </div>
                  </section>
                )}

                <section aria-label="Change summary">
                  <label
                    htmlFor="submit-summary"
                    className="mb-1.5 block text-[11px] font-semibold tracking-wider text-muted-foreground uppercase"
                  >
                    Change summary <span className="text-tone-danger">*</span>
                  </label>
                  <Textarea
                    id="submit-summary"
                    value={summary}
                    onChange={(e) => setSummary(e.target.value)}
                    rows={3}
                    placeholder="What changed and why — reviewers read this first"
                    className="resize-none text-sm"
                    autoFocus
                  />
                </section>

                <section aria-label="Changes">
                  <button
                    type="button"
                    onClick={() => setShowDiff((s) => !s)}
                    aria-expanded={showDiff}
                    className="flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs transition-colors hover:bg-muted/50"
                  >
                    <ChevronDown
                      className={cn(
                        "size-3.5 text-muted-foreground transition-transform",
                        !showDiff && "-rotate-90",
                      )}
                    />
                    <span className="font-medium">
                      {parent
                        ? `Changes since #${parent.number}`
                        : "First version"}
                    </span>
                    <span className="tabular font-mono text-tone-success">
                      +{stats.added}
                    </span>
                    <span className="tabular font-mono text-tone-danger">
                      −{stats.removed}
                    </span>
                    <span className="ml-auto text-muted-foreground">
                      {showDiff ? "Hide diff" : "Show diff"}
                    </span>
                  </button>
                  {showDiff && (
                    <div className="mt-2 h-80 overflow-hidden rounded-lg border">
                      <DiffViewer
                        original={parent?.code ?? ""}
                        modified={code}
                        modelKey={`submit-${snapshot.id}`}
                        mission={mission}
                      />
                    </div>
                  )}
                </section>

                <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm">
                  <Checkbox
                    checked={fork}
                    onCheckedChange={(c) => setFork(c === true)}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="font-medium">
                      Keep editing in a new working copy
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      Starts #{snapshot.number + 1} from this content, so you
                      can carry on while reviewers look at #{snapshot.number}.
                    </span>
                  </span>
                </label>

                {error && (
                  <p
                    role="alert"
                    className="flex items-start gap-2 rounded-lg border border-tone-danger/30 bg-tone-danger/[0.07] px-3 py-2 text-xs text-tone-danger"
                  >
                    <XCircle className="mt-px size-4 shrink-0" /> {error}
                  </p>
                )}
              </div>

              <DialogFooter className="m-0 mx-0 mb-0 shrink-0 items-center rounded-none px-5 py-3">
                <span className="mr-auto flex items-center gap-1.5 text-xs text-muted-foreground">
                  {!pre ? (
                    <>
                      <CircleDashed className="size-3.5 animate-spin" />{" "}
                      Checking…
                    </>
                  ) : sha ? (
                    <span className="font-mono">sha256 {shortHash(sha)}</span>
                  ) : null}
                </span>
                <Button
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  disabled={phase === "submitting"}
                >
                  Cancel
                </Button>
                <Button onClick={() => void submit()} disabled={!canSubmit}>
                  {phase === "submitting" ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <Send />
                  )}{" "}
                  {phase === "submitting" ? "Freezing…" : "Freeze & submit"}
                </Button>
              </DialogFooter>
            </motion.div>
          )}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
}
