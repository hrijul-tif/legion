"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ChevronRight, GitFork, Loader2, OctagonAlert, Pencil, Rocket, ShieldAlert, ShieldCheck, Trash2, FileLock2 } from "lucide-react";
import { toast } from "sonner";
import { discardWorkingCopy, forkSnapshot } from "@/app/actions/lifecycle";
import { StateBadge } from "@/components/mos/state-badge";
import { RelativeTime } from "@/components/mos/time";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { hasRole, shortHash } from "@/lib/lifecycle";
import type { SnapshotPageData } from "@/lib/data/snapshot";
import { person } from "./derive";
import { CopyButton, Pill, SnapLink, Who } from "./bits";

export function SnapshotHeader({ data }: { data: SnapshotPageData }) {
  const { snapshot: s, procedure: p, me } = data;
  const router = useRouter();
  const [forking, startFork] = useTransition();
  const [discardOpen, setDiscardOpen] = useState(false);
  const [discarding, startDiscard] = useTransition();
  const author = person(data, s.author_id);
  const parent = data.siblings.find((x) => x.id === s.parent_snapshot_id) ?? null;
  const isActive = p.active_snapshot_id === s.id;
  const retired = !!p.retired_at;
  const mine = s.author_id === me.id;
  const ownWorkingCopy = s.state === "in_progress" && mine;
  const canFork = hasRole(me.roles, "author") && !retired && !ownWorkingCopy;

  const fork = () =>
    startFork(async () => {
      const res = await forkSnapshot(p.id, s.id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`Working copy #${res.data.number} created from #${s.number}`);
      router.push(`/snapshots/${res.data.snapshotId}/edit`);
    });

  const discard = () =>
    startDiscard(async () => {
      const res = await discardWorkingCopy(s.id);
      if (!res.ok) {
        toast.error(res.error);
        setDiscardOpen(false);
        return;
      }
      toast.success(`Discarded working copy #${s.number}`);
      router.push(`/procedures/${p.id}`);
    });

  return (
    <header className="space-y-4 border-b px-6 pt-5 pb-5 lg:px-8">
      {retired && (
        <div role="status" className="flex items-start gap-2.5 rounded-lg border border-tone-warn/30 bg-tone-warn/10 px-3.5 py-2.5 text-[13px]">
          <OctagonAlert className="mt-0.5 size-4 shrink-0 text-tone-warn" />
          <p>
            <b className="font-medium">This procedure is retired.</b>{" "}
            <span className="text-muted-foreground">
              {p.retired_reason ? `“${p.retired_reason}” ` : ""}Snapshots keep their states but can’t move, and nothing is in PROD.{" "}
              <Link className="text-foreground underline underline-offset-4" href={`/procedures/${p.id}`}>
                Open the procedure
              </Link>{" "}
              to restore it.
            </span>
          </p>
        </div>
      )}

      <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-xs text-muted-foreground">
        <Link href="/procedures" className="hover:text-foreground">
          Procedures
        </Link>
        <ChevronRight className="size-3" />
        <Link href={`/procedures/${p.id}`} className="max-w-[40ch] truncate hover:text-foreground">
          {p.name}
        </Link>
        <ChevronRight className="size-3" />
        <span className="font-mono text-foreground">#{s.number}</span>
        <span className="ml-2 rounded border px-1.5 py-px font-mono text-[10px] tracking-wider">{p.mission}</span>
      </nav>

      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div className="min-w-0 space-y-2.5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className="min-w-0 text-2xl font-semibold tracking-tight">
              <Link href={`/procedures/${p.id}`} className="rounded-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/60">
                {p.name}
              </Link>
            </h1>
            <span className="inline-flex items-center gap-1.5 font-mono text-lg tabular text-muted-foreground">
              <span className="font-semibold text-foreground">#{s.number}</span>
              {s.code_sha256 && (
                <>
                  <span className="text-sm">{shortHash(s.code_sha256)}</span>
                  <CopyButton text={s.code_sha256} label="Copy full SHA-256" />
                </>
              )}
            </span>
            <StateBadge state={s.state} size="md" />
            {isActive && !retired && (
              <Pill tone="success" title="This snapshot is what PROD runs right now" className="h-7 text-sm">
                <Rocket className="size-3.5" /> Active in PROD
              </Pill>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <Who user={author} className="text-foreground" />
              <span>{s.state === "in_progress" ? "started" : "authored"}</span>
            </span>
            <span>
              created <RelativeTime date={s.created_at} />
            </span>
            {s.submitted_at && (
              <span>
                submitted <RelativeTime date={s.submitted_at} />
              </span>
            )}
            {parent && (
              <span className="inline-flex items-center gap-1">
                forked from <SnapLink id={parent.id} number={parent.number} sha={parent.code_sha256} />
              </span>
            )}
          </div>

          {s.summary ? (
            <p className="max-w-3xl border-l-2 pl-3 text-sm leading-relaxed text-foreground/90">{s.summary}</p>
          ) : s.state === "in_progress" ? (
            <p className="max-w-3xl border-l-2 border-dashed pl-3 text-sm text-muted-foreground">No change summary yet — the author writes one when submitting.</p>
          ) : null}
        </div>

        <div className="flex flex-col items-end gap-3">
          <IntegrityChip data={data} />
          <div className="flex flex-wrap items-center justify-end gap-2">
            {ownWorkingCopy && (
              <>
                <Button asChild size="lg">
                  <Link href={`/snapshots/${s.id}/edit`}>
                    <Pencil /> Open in editor
                  </Link>
                </Button>
                <Button variant="outline" size="lg" className="text-muted-foreground hover:text-destructive" onClick={() => setDiscardOpen(true)}>
                  <Trash2 /> Discard
                </Button>
              </>
            )}
            {canFork && (
              <Button variant={ownWorkingCopy ? "outline" : "default"} size="lg" onClick={fork} disabled={forking}>
                {forking ? <Loader2 className="animate-spin" /> : <GitFork />} Fork into working copy
              </Button>
            )}
          </div>
        </div>
      </div>

      <AlertDialog open={discardOpen} onOpenChange={(o) => !discarding && setDiscardOpen(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard working copy #{s.number}?</AlertDialogTitle>
            <AlertDialogDescription>
              The unsubmitted code is deleted and can’t be recovered. The discard is recorded on the procedure’s audit trail. This is only possible because nothing has been forked from it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={discarding}>Keep it</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={discarding}
              onClick={(e) => {
                e.preventDefault();
                discard();
              }}
            >
              {discarding && <Loader2 className="animate-spin" />} Discard working copy
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </header>
  );
}

function IntegrityChip({ data }: { data: SnapshotPageData }) {
  const { snapshot: s, verified, codeError } = data;
  if (s.state === "in_progress") {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={0}>
            <Pill tone="neutral" className="cursor-help">
              <FileLock2 /> Working copy — not frozen
            </Pill>
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-72 flex-col items-start">
          This is the author’s editable draft. It has no hash yet; the code is frozen and hashed (SHA-256) when it is submitted.
        </TooltipContent>
      </Tooltip>
    );
  }
  if (verified === false) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={0}>
            <Pill tone="danger" className="cursor-help">
              <ShieldAlert /> Hash mismatch
            </Pill>
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-80 flex-col items-start gap-1">
          <span>The stored code no longer matches the SHA-256 recorded when it was submitted. Do not trust this snapshot — tell an administrator.</span>
          <span className="font-mono text-[10px] break-all opacity-80">expected {s.code_sha256}</span>
        </TooltipContent>
      </Tooltip>
    );
  }
  if (verified === true) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={0}>
            <Pill tone="success" className="cursor-help">
              <ShieldCheck /> SHA-256 verified
            </Pill>
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-80 flex-col items-start gap-1">
          <span>The bytes you see were just re-hashed and match the hash recorded at submission. These are exactly the bytes that were submitted — nobody can change a snapshot.</span>
          <span className="font-mono text-[10px] break-all opacity-80">{s.code_sha256}</span>
        </TooltipContent>
      </Tooltip>
    );
  }
  return (
    <Pill tone="warn" title={codeError ?? undefined}>
      <ShieldAlert /> Could not verify
    </Pill>
  );
}
