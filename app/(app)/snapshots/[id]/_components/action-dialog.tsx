"use client";

import { useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import { ArrowRight, Loader2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { transitionSnapshot } from "@/app/actions/lifecycle";
import { StateBadge } from "@/components/mos/state-badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ACTIONS, STATE_META, type ManualAction } from "@/lib/lifecycle";
import type { SnapshotPageData } from "@/lib/data/snapshot";
import { activeSibling } from "./derive";

type Data = SnapshotPageData;

const COMMENT_HINT: Partial<Record<ManualAction, string>> = {
  review_pass: "Anything the tester should watch for (optional)",
  review_fail: "What has to change? The author will see this.",
  test_pass: "What you ran and what you saw (optional)",
  test_fail: "What failed, on which step, and how to reproduce it",
  retest: "Why retest? e.g. the test setup was wrong",
  approve: "Anything worth recording alongside the approval (optional)",
  refuse: "Why is this not cleared for flight?",
  send_back: "What new test cases are needed?",
  reactivate: "Why roll back? This goes in the audit trail.",
  withdraw: "Why is approval being removed?",
};

export function evidenceFor(d: Data): Record<string, unknown> {
  const runIds = new Set<string>(d.runs.map((r) => r.id));
  for (const t of d.tests) if (t.run_id) runIds.add(t.run_id);
  return { test_record_ids: d.tests.map((t) => t.id), run_ids: [...runIds] };
}

function Consequences({ action, d }: { action: ManualAction; d: Data }) {
  const n = d.snapshot.number;
  const active = activeSibling(d);
  const unresolved = d.comments.filter((c) => !c.resolved_at).length;
  const pass = d.tests.filter((t) => t.result === "pass").length;
  const fail = d.tests.filter((t) => t.result === "fail").length;
  const blocked = d.tests.filter((t) => t.result === "blocked").length;
  const items: { tone?: "warn"; node: ReactNode }[] = [];

  switch (action) {
    case "review_pass":
      items.push({ node: <>#{n} moves to <b>Review Passed, Test in Progress</b>. Testing starts straight away — a tester can record results and attach dry runs.</> });
      if (unresolved > 0)
        items.push({ tone: "warn", node: <>{unresolved} review comment{unresolved === 1 ? " is" : "s are"} still unresolved. You can pass anyway; they stay visible on the snapshot.</> });
      break;
    case "review_fail":
      items.push({ node: <>#{n} becomes <b>Review Failed</b> and cannot move again. A snapshot never changes, so the author has to fork it into a new working copy and resubmit.</> });
      break;
    case "test_pass":
      items.push({ node: <>#{n} moves to <b>Tests Passed, Awaiting Approval</b>. An approver can then clear it for flight.</> });
      items.push({
        node: (
          <>
            Evidence attached: <b>{d.tests.length}</b> test case{d.tests.length === 1 ? "" : "s"} ({pass} passed{fail ? `, ${fail} failed` : ""}
            {blocked ? `, ${blocked} blocked` : ""}) and <b>{(evidenceFor(d).run_ids as string[]).length}</b> dry run{(evidenceFor(d).run_ids as string[]).length === 1 ? "" : "s"}.
          </>
        ),
      });
      if (d.tests.length === 0)
        items.push({ tone: "warn", node: <>No test cases are recorded on the Test tab. MOS cannot tell whether tests were run — it records that <i>you</i> said they passed.</> });
      if (fail > 0) items.push({ tone: "warn", node: <>{fail} recorded test case{fail === 1 ? " has" : "s have"} failed. Consider recording a failure instead.</> });
      break;
    case "test_fail":
      items.push({ node: <>#{n} becomes <b>Test Failed</b>. It stays visible in every list as failed; the author or a tester can start a retest without a new submission.</> });
      break;
    case "retest":
      items.push({ node: <>#{n} returns to <b>Test in Progress</b>. No new submission or review is needed.</> });
      break;
    case "approve":
      items.push({
        node: active ? (
          <>
            <b>#{n} becomes active in PROD immediately.</b> #{active.number} (currently active) will be <b>Superseded</b> in the same moment — and can be reactivated later.
          </>
        ) : (
          <>
            <b>#{n} becomes active in PROD immediately.</b> No snapshot is currently active for this procedure.
          </>
        ),
      });
      items.push({ node: <>Sheets that start from now on run #{n}. A sheet already running keeps the snapshot it started with.</> });
      break;
    case "refuse":
      items.push({ node: <>#{n} becomes <b>Approval Failed</b>. It can only go back for retesting — there is no direct route to Approved.</> });
      break;
    case "send_back":
      items.push({ node: <>#{n} returns to <b>Test in Progress</b> so new test cases can be added. No second review.</> });
      break;
    case "reactivate":
      items.push({
        node: active ? (
          <>
            <b>Rollback.</b> #{n} becomes active in PROD immediately, without a review or test cycle. #{active.number} (currently active) will be <b>Superseded</b>.
          </>
        ) : (
          <>
            <b>#{n} becomes active in PROD immediately</b>, without a review or test cycle. No other snapshot is active right now.
          </>
        ),
      });
      break;
    case "withdraw":
      items.push({ node: <>#{n} becomes <b>Withdrawn</b>. It stays in the history and can be reactivated later without a review.</> });
      items.push({ node: <>The procedure then has no active snapshot unless another is approved or reactivated.</> });
      break;
  }

  return (
    <ul className="space-y-2">
      {items.map((it, i) => (
        <li
          key={i}
          className={
            it.tone === "warn"
              ? "flex gap-2 rounded-lg border border-tone-warn/25 bg-tone-warn/10 px-3 py-2 text-[13px] text-foreground"
              : "text-[13px] leading-relaxed text-muted-foreground [&_b]:font-medium [&_b]:text-foreground"
          }
        >
          {it.tone === "warn" && <TriangleAlert className="mt-0.5 size-4 shrink-0 text-tone-warn" />}
          <span className={it.tone === "warn" ? "[&_b]:font-medium" : undefined}>{it.node}</span>
        </li>
      ))}
    </ul>
  );
}

export function resultMessage(action: ManualAction, number: number, supersededNumber: number | null): string {
  const sup = supersededNumber ? ` — #${supersededNumber} superseded` : "";
  switch (action) {
    case "approve":
      return `Approved #${number}${sup}. It is now active in PROD.`;
    case "reactivate":
      return `Reactivated #${number}${sup}`;
    case "review_pass":
      return `Review passed — #${number} is now in test`;
    case "review_fail":
      return `Review failed — #${number} is closed; the author can fork it`;
    case "test_pass":
      return `Tests passed — #${number} is awaiting approval`;
    case "test_fail":
      return `Test failure recorded for #${number}`;
    case "retest":
      return `Retest started — #${number} is back in test`;
    case "refuse":
      return `Approval refused for #${number}`;
    case "send_back":
      return `#${number} sent back for retesting`;
    case "withdraw":
      return `Withdrew #${number}`;
  }
}

export function ActionDialog({ data, action, open, onOpenChange }: { data: Data; action: ManualAction; open: boolean; onOpenChange: (open: boolean) => void }) {
  const meta = ACTIONS[action];
  const [comment, setComment] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!open) return;
    // fresh slate every time the dialog opens
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setComment("");
    setConfirmText("");
    setError(null);
  }, [open, action]);

  const needsComment = meta.needsComment;
  const phrase = meta.confirm;
  const ready = (!needsComment || comment.trim().length > 0) && (!phrase || confirmText.trim().toUpperCase() === phrase);
  const evidence = useMemo(() => (action === "test_pass" || action === "test_fail" ? evidenceFor(data) : undefined), [action, data]);

  const submit = () => {
    if (!ready || pending) return;
    start(async () => {
      const res = await transitionSnapshot({ snapshotId: data.snapshot.id, action, comment: comment.trim() || undefined, evidence });
      if (!res.ok) {
        setError(res.error);
        toast.error(res.error);
        return;
      }
      toast.success(resultMessage(action, data.snapshot.number, res.data.supersededNumber));
      onOpenChange(false);
    });
  };

  const negative = meta.intent === "negative";
  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-lg" onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            {meta.label}
            <span className="font-mono text-sm font-normal text-muted-foreground">#{data.snapshot.number}</span>
          </DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-2 pt-1">
            <StateBadge state={data.snapshot.state} size="xs" />
            <ArrowRight className="size-3.5 text-muted-foreground" />
            <StateBadge state={meta.to} size="xs" />
            <span className="text-xs text-muted-foreground">{STATE_META[meta.to].env ? `→ ${STATE_META[meta.to].env}` : ""}</span>
          </DialogDescription>
        </DialogHeader>

        <Consequences action={action} d={data} />

        <div className="space-y-1.5">
          <Label htmlFor="action-comment" className="text-xs">
            Comment {needsComment ? <span className="text-tone-danger">(required)</span> : <span className="text-muted-foreground">(optional)</span>}
          </Label>
          <Textarea
            id="action-comment"
            autoFocus
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit();
            }}
            placeholder={COMMENT_HINT[action]}
            rows={3}
            disabled={pending}
            className="resize-none text-sm"
          />
        </div>

        {phrase && (
          <div className="space-y-1.5">
            <Label htmlFor="action-confirm" className="text-xs">
              Type <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-foreground">{phrase}</span> to confirm
            </Label>
            <Input
              id="action-confirm"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              placeholder={phrase}
              autoComplete="off"
              spellCheck={false}
              disabled={pending}
              className="font-mono"
            />
          </div>
        )}

        {error && (
          <p role="alert" className="rounded-lg border border-tone-danger/25 bg-tone-danger/10 px-3 py-2 text-[13px] text-tone-danger">
            {error}
          </p>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            variant={negative ? "destructive" : "default"}
            onClick={submit}
            disabled={!ready || pending}
            className={negative ? "border border-destructive/30" : undefined}
          >
            {pending && <Loader2 className="animate-spin" />}
            {meta.label}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
