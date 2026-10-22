"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, GitFork, Loader2, Lock } from "lucide-react";
import { toast } from "sonner";
import { forkSnapshot } from "@/app/actions/lifecycle";
import { Button } from "@/components/ui/button";
import { SnapshotRef } from "@/components/mos/hash";
import { StateBadge } from "@/components/mos/state-badge";
import { UserChip } from "@/components/mos/user-avatar";
import type { EditBlock, EditorPageData } from "@/lib/ide/types";

/** Shown instead of the workspace when the viewer cannot edit this snapshot. */
export function FrozenState({
  data,
  block,
}: {
  data: EditorPageData;
  block: Exclude<EditBlock, { kind: "ok" }>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const { snapshot, procedure } = data;
  const retired = !!procedure.retiredAt;

  const fork = async () => {
    setBusy(true);
    const res = await forkSnapshot(procedure.id, snapshot.id);
    if (!res.ok) {
      toast.error(res.error);
      setBusy(false);
      return;
    }
    toast.success(`You're now editing working copy #${res.data.number}`);
    router.push(`/snapshots/${res.data.snapshotId}/edit`);
  };

  return (
    <div className="bg-grid flex h-full min-h-[28rem] items-center justify-center p-6">
      <div className="w-full max-w-md space-y-5 rounded-2xl border bg-card p-6 text-center">
        <span className="mx-auto flex size-12 items-center justify-center rounded-full border bg-muted/50 text-muted-foreground">
          <Lock className="size-5" />
        </span>
        <div className="space-y-1.5">
          <h1 className="text-lg font-semibold tracking-tight">
            {block.kind === "frozen"
              ? "This snapshot is frozen"
              : "You can’t edit this working copy"}
          </h1>
          <p className="text-sm text-muted-foreground">{block.reason}</p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 rounded-lg border bg-muted/30 px-3 py-2 text-sm">
          <span className="font-mono text-xs font-semibold">
            {procedure.name}
          </span>
          <SnapshotRef number={snapshot.number} sha={snapshot.sha} />
          <StateBadge state={snapshot.state} size="xs" short />
          <UserChip user={snapshot.author} className="text-xs" />
        </div>
        {retired && (
          <p className="rounded-lg border border-tone-danger/25 bg-tone-danger/[0.07] px-3 py-2 text-xs text-tone-danger">
            This procedure is retired, so no new working copies can be started.
          </p>
        )}
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Button asChild variant="outline">
            <Link href={`/snapshots/${snapshot.id}`}>
              <Eye /> Open read-only
            </Link>
          </Button>
          <Button onClick={() => void fork()} disabled={busy || retired}>
            {busy ? <Loader2 className="animate-spin" /> : <GitFork />} Fork
            into my working copy
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Forking copies this content into a new working copy that only you can
          edit. The original stays untouched.
        </p>
      </div>
    </div>
  );
}
