"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowRight, Check, CircleDashed, Info, Loader2, OctagonX, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { transitionSnapshot } from "@/app/actions/lifecycle";
import { RelativeTime } from "@/components/mos/time";
import { StateBadge } from "@/components/mos/state-badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { ACTIONS, type SnapshotState } from "@/lib/lifecycle";
import type { SiblingSnapshot, SnapshotPageData } from "@/lib/data/snapshot";
import { approvalHistory, person } from "./derive";
import { Who } from "./bits";

type Step = "pending" | "running" | "done" | "failed";

interface AuditRow {
  key: string;
  verb: string;
  snapshot: number;
  from: SnapshotState;
  to: SnapshotState;
  note: string;
  system?: boolean;
}

/**
 * The active snapshot cannot be withdrawn directly. This guided flow reactivates another previously-approved
 * snapshot (which supersedes this one) and then withdraws this one, as two audited transitions.
 */
export function WithdrawFlowDialog({ data, open, onOpenChange }: { data: SnapshotPageData; open: boolean; onOpenChange: (o: boolean) => void }) {
  const me = data.me;
  const n = data.snapshot.number;
  const candidates = useMemo(
    () => data.siblings.filter((s) => s.id !== data.snapshot.id && (s.state === "superseded" || s.state === "withdrawn")),
    [data.siblings, data.snapshot.id],
  );
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [steps, setSteps] = useState<[Step, Step]>(["pending", "pending"]);
  const [locked, setLocked] = useState<SiblingSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [finishedAt, setFinishedAt] = useState<Date | null>(null);

  const running = steps.some((s) => s === "running");
  const finished = steps[1] === "done";
  const started = steps[0] !== "pending";
  const target = locked ?? candidates.find((c) => c.id === chosenId) ?? null;
  const phrase = ACTIONS.reactivate.confirm!;
  const canGo = !!target && comment.trim().length > 0 && confirmText.trim().toUpperCase() === phrase && !running;

  const reset = () => {
    setChosenId(null);
    setComment("");
    setConfirmText("");
    setSteps(["pending", "pending"]);
    setLocked(null);
    setError(null);
    setAudit([]);
    setFinishedAt(null);
  };

  const close = (o: boolean) => {
    if (running) return;
    onOpenChange(o);
    if (!o) setTimeout(reset, 200);
  };

  const run = async () => {
    if (!target) return;
    const text = comment.trim();
    setError(null);
    setLocked(target);
    let rows = audit;

    if (steps[0] !== "done") {
      setSteps(["running", "pending"]);
      const r1 = await transitionSnapshot({ snapshotId: target.id, action: "reactivate", comment: text });
      if (!r1.ok) {
        setSteps(["failed", "pending"]);
        setError(r1.error);
        toast.error(r1.error);
        return;
      }
      rows = [
        { key: "react", verb: "reactivated", snapshot: target.number, from: target.state, to: "approved", note: text },
        { key: "sup", verb: "superseded", snapshot: n, from: "approved", to: "superseded", note: `Rolled back: #${target.number} reactivated in place of #${n}`, system: true },
      ];
      setAudit(rows);
    }

    setSteps(["done", "running"]);
    const r2 = await transitionSnapshot({ snapshotId: data.snapshot.id, action: "withdraw", comment: text });
    if (!r2.ok) {
      setSteps(["done", "failed"]);
      setError(r2.error);
      toast.error(r2.error);
      return;
    }
    setAudit([...rows, { key: "wd", verb: "withdrew", snapshot: n, from: "superseded", to: "withdrawn", note: text }]);
    setSteps(["done", "done"]);
    setFinishedAt(new Date());
    toast.success(`Withdrew #${n} — #${target.number} was reactivated first`);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl" onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Withdraw the active snapshot <span className="font-mono text-sm font-normal text-muted-foreground">#{n}</span>
          </DialogTitle>
          <DialogDescription>
            <span className="inline-flex flex-wrap items-center gap-2">
              <StateBadge state="approved" size="xs" /> <ArrowRight className="size-3.5" /> <StateBadge state="superseded" size="xs" />
              <ArrowRight className="size-3.5" /> <StateBadge state="withdrawn" size="xs" />
            </span>
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2.5 rounded-lg border border-tone-info/25 bg-tone-info/10 px-3 py-2.5 text-[13px] leading-relaxed">
          <Info className="mt-0.5 size-4 shrink-0 text-tone-info" />
          <p>
            <b className="font-medium">An active snapshot can’t be withdrawn directly.</b> To take #{n} out of PROD you first reactivate an earlier approved snapshot — that supersedes #{n} — and then
            withdraw #{n}. MOS performs both steps for you and records each one in the audit trail.
          </p>
        </div>

        {candidates.length === 0 ? (
          <div className="space-y-3 rounded-lg border border-dashed p-4 text-[13px]">
            <p className="font-medium">There’s nothing to fall back to.</p>
            <p className="text-muted-foreground">
              No other snapshot of this procedure has been approved before, so #{n} can’t be withdrawn without leaving PROD in an undefined state. To take the whole procedure out of PROD, retire it from the
              procedure page — snapshots keep their states, and restoring the procedure brings #{n} back.
            </p>
            <Button asChild variant="outline" size="sm">
              <Link href={`/procedures/${data.procedure.id}`}>
                <OctagonX /> Go to the procedure to retire it
              </Link>
            </Button>
          </div>
        ) : (
          <>
            <fieldset disabled={started} className="space-y-2">
              <legend className="mb-1.5 text-xs font-medium">1 · Reactivate first — pick the snapshot PROD should run instead</legend>
              <div role="radiogroup" aria-label="Snapshot to reactivate" className="space-y-1.5">
                {candidates.map((c) => {
                  const hist = approvalHistory(data.transitions, c.id);
                  const selected = (locked?.id ?? chosenId) === c.id;
                  return (
                    <label
                      key={c.id}
                      className={cn(
                        "flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors hover:bg-muted/40 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/50",
                        selected && "border-primary/60 bg-primary/5",
                        started && !selected && "opacity-40",
                      )}
                    >
                      <input
                        type="radio"
                        name="fallback"
                        value={c.id}
                        checked={selected}
                        onChange={() => setChosenId(c.id)}
                        className="mt-1 size-3.5 accent-[var(--primary)]"
                      />
                      <span className="min-w-0 flex-1 space-y-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-sm font-semibold">#{c.number}</span>
                          <span className="font-mono text-xs text-muted-foreground">{c.code_sha256?.slice(0, 7)}</span>
                          <StateBadge state={c.state} size="xs" short />
                        </span>
                        {c.summary && <span className="line-clamp-2 block text-[13px] text-muted-foreground">{c.summary}</span>}
                        <span className="block space-y-0.5 text-[12px] text-muted-foreground">
                          {hist.length === 0 && <span>No approval recorded</span>}
                          {hist.slice(-2).map((h) => {
                            const p = person(data, h.actor_id);
                            return (
                              <span key={h.id} className="flex items-center gap-1.5">
                                <Check className="size-3 text-tone-success" />
                                {h.action === "reactivate" ? "Reactivated" : "Approved"} by <span className="font-medium text-foreground">{p.displayName}</span> <RelativeTime date={h.created_at} />
                              </span>
                            );
                          })}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>

            <div className="space-y-1.5">
              <Label htmlFor="wd-comment" className="text-xs">
                Reason <span className="text-tone-danger">(required)</span> <span className="text-muted-foreground">— recorded on both steps</span>
              </Label>
              <Textarea
                id="wd-comment"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                disabled={started}
                rows={2}
                placeholder={`Why is #${n} being taken out of PROD?`}
                className="resize-none text-sm"
              />
            </div>
            {!started && (
              <div className="space-y-1.5">
                <Label htmlFor="wd-confirm" className="text-xs">
                  Type <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-foreground">{phrase}</span> to confirm the rollback
                </Label>
                <Input id="wd-confirm" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder={phrase} autoComplete="off" spellCheck={false} className="font-mono" />
              </div>
            )}

            {(started || target) && (
              <ol className="space-y-2 rounded-lg border bg-muted/20 p-3" aria-label="Progress">
                <StepRow
                  status={steps[0]}
                  title={target ? `Reactivate #${target.number}` : "Reactivate the chosen snapshot"}
                  detail={target ? `#${target.number} becomes active in PROD; #${n} is superseded.` : "Pick a snapshot above."}
                />
                <StepRow status={steps[1]} title={`Withdraw #${n}`} detail={`#${n} moves from Superseded to Withdrawn and stays in the history.`} />
              </ol>
            )}

            {error && (
              <p role="alert" className="rounded-lg border border-tone-danger/25 bg-tone-danger/10 px-3 py-2 text-[13px] text-tone-danger">
                {steps[0] === "done" ? `Step 1 completed — #${locked?.number} is now active and #${n} is Superseded. Step 2 failed: ` : "Step 1 failed: "}
                {error}
              </p>
            )}

            {finished && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium">Recorded in the audit trail</p>
                <ul className="divide-y rounded-lg border text-[13px]">
                  {audit.map((r) => (
                    <li key={r.key} className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2">
                      {r.system ? <span className="text-muted-foreground">System</span> : <Who user={me} size={18} />}
                      <span>{r.verb}</span>
                      <span className="font-mono font-semibold">#{r.snapshot}</span>
                      <StateBadge state={r.from} size="xs" short showCode={false} />
                      <ArrowRight className="size-3 text-muted-foreground" />
                      <StateBadge state={r.to} size="xs" short showCode={false} />
                      <span className="w-full truncate text-xs text-muted-foreground">{r.note}</span>
                    </li>
                  ))}
                </ul>
                <p className="text-[11px] text-muted-foreground">
                  <RelativeTime date={finishedAt} />
                </p>
              </div>
            )}
          </>
        )}

        <DialogFooter>
          {finished ? (
            <Button onClick={() => close(false)}>Done</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => close(false)} disabled={running}>
                {started ? "Close" : "Cancel"}
              </Button>
              {candidates.length > 0 && (
                <Button variant="destructive" className="border border-destructive/30" onClick={run} disabled={!canGo}>
                  {running ? <Loader2 className="animate-spin" /> : <Undo2 />}
                  {steps[0] === "done" ? "Retry step 2" : "Reactivate, then withdraw"}
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StepRow({ status, title, detail }: { status: Step; title: string; detail: string }) {
  return (
    <li className="flex items-start gap-2.5">
      <span className="mt-0.5">
        {status === "done" ? (
          <Check className="size-4 text-tone-success" />
        ) : status === "running" ? (
          <Loader2 className="size-4 animate-spin text-primary" />
        ) : status === "failed" ? (
          <OctagonX className="size-4 text-tone-danger" />
        ) : (
          <CircleDashed className="size-4 text-muted-foreground" />
        )}
      </span>
      <span className="min-w-0">
        <span className={cn("block text-[13px] font-medium", status === "pending" && "text-muted-foreground")}>{title}</span>
        <span className="block text-xs text-muted-foreground">{detail}</span>
      </span>
    </li>
  );
}
