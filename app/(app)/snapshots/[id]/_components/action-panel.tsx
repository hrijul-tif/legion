"use client";

import { AlertTriangle, Ban, Check, CheckCheck, FlaskConical, Hourglass, OctagonX, RotateCcw, Rocket, Undo2, X, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { UserAvatar } from "@/components/mos/user-avatar";
import { StateBadge } from "@/components/mos/state-badge";
import { cn } from "@/lib/utils";
import { ACTIONS, STATE_META, availableActions, hasRole, type ManualAction } from "@/lib/lifecycle";
import type { SnapshotPageData } from "@/lib/data/snapshot";
import { activeSibling, whoCanActNext } from "./derive";
import { SectionCard, SnapLink } from "./bits";

const ICONS: Record<ManualAction, LucideIcon> = {
  review_pass: Check,
  review_fail: X,
  test_pass: CheckCheck,
  test_fail: FlaskConical,
  retest: RotateCcw,
  approve: Rocket,
  refuse: Ban,
  send_back: Undo2,
  reactivate: Undo2,
  withdraw: OctagonX,
};

export function computeAvailability(d: SnapshotPageData) {
  const reviewedByMe = d.transitions.some((t) => t.snapshot_id === d.snapshot.id && t.action === "review_pass" && t.actor_id === d.me.id);
  return availableActions({
    state: d.snapshot.state,
    isAuthor: d.snapshot.author_id === d.me.id,
    roles: d.me.roles,
    reviewedByMe,
    allowSelfActions: d.allowSelfActions,
    retired: !!d.procedure.retired_at,
  });
}

export function ActionPanel({ data, onAction, onWithdrawFlow }: { data: SnapshotPageData; onAction: (a: ManualAction) => void; onWithdrawFlow: () => void }) {
  const avail = computeAvailability(data);
  const state = data.snapshot.state;
  const meta = STATE_META[state];
  const retired = !!data.procedure.retired_at;
  const canGuidedWithdraw = state === "approved" && hasRole(data.me.roles, "approver") && !retired;
  const hasEnabled = avail.some((a) => a.enabled) || canGuidedWithdraw;
  const active = activeSibling(data);
  const next = whoCanActNext(data);

  return (
    <aside className="space-y-3 lg:sticky lg:top-4" aria-label="Actions">
      <SectionCard title="Your move" bodyClassName="space-y-2.5">
        <div className="flex items-center gap-2">
          <StateBadge state={state} size="sm" />
        </div>
        <p className="text-[13px] leading-relaxed text-muted-foreground">{meta.description}</p>

        {(avail.length > 0 || canGuidedWithdraw) && (
          <div className="flex flex-col gap-2 pt-1">
            {avail.map(({ action, enabled, reason }) => (
              <ActionButton key={action} action={action} enabled={enabled} reason={reason} onClick={() => onAction(action)} />
            ))}
            {canGuidedWithdraw && (
              <Button variant="outline" className="h-9 w-full justify-start border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={onWithdrawFlow}>
                <OctagonX /> Withdraw…
              </Button>
            )}
          </div>
        )}

        {!hasEnabled && <WaitingFor data={data} next={next} retired={retired} hasButtons={avail.length > 0} />}
      </SectionCard>

      <SectionCard bodyClassName="space-y-2 text-[13px]">
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground">In PROD now</span>
          {active ? (
            <span className="inline-flex items-center gap-1.5">
              {active.id === data.snapshot.id ? <span className="text-tone-success">this snapshot</span> : <SnapLink id={active.id} number={active.number} sha={active.code_sha256} />}
            </span>
          ) : (
            <span className="text-muted-foreground">nothing active</span>
          )}
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground">Snapshots of this procedure</span>
          <span className="tabular">{data.siblings.length}</span>
        </div>
      </SectionCard>
    </aside>
  );
}

function ActionButton({ action, enabled, reason, onClick }: { action: ManualAction; enabled: boolean; reason?: string; onClick: () => void }) {
  const meta = ACTIONS[action];
  const Icon = ICONS[action];
  const btn = (
    <Button
      variant={meta.intent === "positive" ? "default" : "outline"}
      disabled={!enabled}
      onClick={onClick}
      className={cn(
        "h-9 w-full justify-start",
        meta.intent === "negative" && "border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive",
        !enabled && "pointer-events-none",
      )}
    >
      <Icon />
      {meta.label}
    </Button>
  );
  if (enabled) return btn;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="block rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50" aria-label={`${meta.label} — unavailable: ${reason ?? ""}`}>
          {btn}
        </span>
      </TooltipTrigger>
      <TooltipContent side="left">{reason ?? "Not available"}</TooltipContent>
    </Tooltip>
  );
}

function WaitingFor({ data, next, retired, hasButtons }: { data: SnapshotPageData; next: ReturnType<typeof whoCanActNext>; retired: boolean; hasButtons: boolean }) {
  const state = data.snapshot.state;
  if (retired) {
    return (
      <Note icon={<AlertTriangle className="text-tone-warn" />}>
        This procedure is <b>retired</b>, so its snapshots can’t move. Restore it from the procedure page to continue.
      </Note>
    );
  }
  if (state === "in_progress") {
    return (
      <Note icon={<Hourglass />}>
        A working copy. {data.snapshot.author_id === data.me.id ? "Open it in the editor and submit when it’s ready." : `Only ${data.people[data.snapshot.author_id]?.displayName ?? "its author"} edits it — fork it to build on it.`}
      </Note>
    );
  }
  if (state === "review_failed") {
    return <Note icon={<Ban className="text-tone-danger" />}>This snapshot is finished. The fix is a <b>new snapshot</b> — fork it into a working copy and resubmit.</Note>;
  }
  if (state === "approved") {
    return <Note icon={<Rocket className="text-tone-success" />}>This is what PROD runs. A newer approval supersedes it automatically — and an approver can always roll back.</Note>;
  }
  if (next.length === 0) return null;
  return (
    <div className="space-y-2 rounded-lg border border-dashed p-3">
      <p className="flex items-center gap-1.5 text-xs font-medium">
        <Hourglass className="size-3.5 text-muted-foreground" />
        {hasButtons ? "Not available to you right now" : "Who can act next"}
      </p>
      {next.map((n) => (
        <div key={n.role + n.verb} className="space-y-1.5 text-[13px]">
          <p className="text-muted-foreground">
            Waiting for {/^[aeiou]/.test(n.role) ? "an" : "a"} <b className="font-medium text-foreground">{n.role}</b>
            {n.people.length > 0 ? (
              <>
                {" "}
                — {n.people.slice(0, 3).map((p) => p.displayName).join(", ")}
                {n.people.length > 3 ? ` and ${n.people.length - 3} more` : ""} can {n.verb}.
              </>
            ) : (
              <> — nobody currently can {n.verb}{data.allowSelfActions ? "" : " (self-review is off)"}.</>
            )}
          </p>
          {n.people.length > 0 && (
            <div className="flex -space-x-1.5">
              {n.people.slice(0, 5).map((p) => (
                <UserAvatar key={p.id} user={p} size={22} ring />
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function Note({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex gap-2.5 rounded-lg border border-dashed p-3 text-[13px] leading-relaxed text-muted-foreground [&_b]:font-medium [&_b]:text-foreground [&_svg]:mt-0.5 [&_svg]:size-4 [&_svg]:shrink-0">
      {icon}
      <p>{children}</p>
    </div>
  );
}
