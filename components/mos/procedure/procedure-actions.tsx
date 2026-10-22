"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArchiveRestore, Archive, ChevronDown, GitFork, Loader2, PencilLine, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { StateBadge } from "@/components/mos/state-badge";
import { forkSnapshot, setProcedureRetired } from "@/app/actions/lifecycle";
import type { SnapshotState } from "@/lib/lifecycle";

export interface ForkableSnapshot {
  id: string;
  number: number;
  state: SnapshotState;
  summary: string | null;
}

export interface ProcedureActionsProps {
  procedureId: string;
  procedureName: string;
  retired: boolean;
  canAuthor: boolean;
  canApprove: boolean;
  /** What "Start working copy" forks: the active snapshot, else the latest, else nothing. */
  forkParent: { id: string; number: number; kind: "active" | "latest" } | null;
  myCopy: { id: string; number: number } | null;
  forkables: ForkableSnapshot[];
}

export function ProcedureActions(props: ProcedureActionsProps) {
  const { procedureId, retired, canAuthor, canApprove, forkParent, myCopy, forkables } = props;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [retireOpen, setRetireOpen] = useState(false);

  function fork(parentId: string | null) {
    startTransition(async () => {
      const res = await forkSnapshot(procedureId, parentId);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`Working copy #${res.data.number} created`);
      router.push(`/snapshots/${res.data.snapshotId}/edit`);
    });
  }

  const forkLabel = forkParent ? `Forks #${forkParent.number}${forkParent.kind === "active" ? " (active in PROD)" : " (latest)"}` : "Starts from an empty file";

  return (
    <>
      {canAuthor && (
        <div className="flex items-center">
          {myCopy ? (
            <Button asChild className="rounded-r-none">
              <Link href={`/snapshots/${myCopy.id}/edit`}>
                <PencilLine data-icon="inline-start" /> Continue your working copy #{myCopy.number}
              </Link>
            </Button>
          ) : (
            <Button className="rounded-r-none" disabled={retired || pending} title={retired ? "Restore the procedure first" : forkLabel} onClick={() => fork(forkParent?.id ?? null)}>
              {pending ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Play data-icon="inline-start" />} Start working copy
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" className="rounded-l-none border-l border-l-primary-foreground/20" aria-label="Fork a specific snapshot" disabled={retired || pending}>
                <ChevronDown />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-80">
              {myCopy && (
                <>
                  <DropdownMenuItem onSelect={() => fork(forkParent?.id ?? null)}>
                    <Play /> Start another working copy
                    <span className="ml-auto text-xs text-muted-foreground">{forkParent ? `from #${forkParent.number}` : "empty"}</span>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuLabel className="flex items-center gap-1.5">
                <GitFork className="size-3.5" /> Fork a specific snapshot…
              </DropdownMenuLabel>
              <div className="max-h-72 overflow-y-auto">
                {forkables.length === 0 && <p className="px-2 py-3 text-xs text-muted-foreground">No frozen snapshots yet.</p>}
                {forkables.map((s) => (
                  <DropdownMenuItem key={s.id} onSelect={() => fork(s.id)} className="items-start gap-2">
                    <span className="font-mono font-semibold tabular">#{s.number}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs text-muted-foreground">{s.summary || "No change note"}</span>
                    </span>
                    <StateBadge state={s.state} size="xs" short showCode={false} />
                  </DropdownMenuItem>
                ))}
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => fork(null)}>
                <GitFork /> Start from an empty file
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      {canApprove && (
        <Button variant={retired ? "outline" : "destructive"} onClick={() => setRetireOpen(true)}>
          {retired ? <ArchiveRestore data-icon="inline-start" /> : <Archive data-icon="inline-start" />}
          {retired ? "Restore" : "Retire"}
        </Button>
      )}

      {canApprove && <RetireDialog open={retireOpen} onOpenChange={setRetireOpen} procedureId={procedureId} name={props.procedureName} retired={retired} />}
    </>
  );
}

function RetireDialog({ open, onOpenChange, procedureId, name, retired }: { open: boolean; onOpenChange: (v: boolean) => void; procedureId: string; name: string; retired: boolean }) {
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();
  const valid = reason.trim().length > 0;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    startTransition(async () => {
      const res = await setProcedureRetired(procedureId, !retired, reason.trim());
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(retired ? "Procedure restored" : "Procedure retired");
      setReason("");
      onOpenChange(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !pending && onOpenChange(v)}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{retired ? "Restore procedure" : "Retire procedure"}</DialogTitle>
            <DialogDescription className="font-mono break-all">{name}</DialogDescription>
          </DialogHeader>
          <ul className="grid gap-1.5 rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
            {retired ? (
              <>
                <li>The procedure becomes usable again; new working copies and transitions are allowed.</li>
                <li>Its approved snapshot (if any) is available to PROD again immediately.</li>
              </>
            ) : (
              <>
                <li>Blocks all new use: no new working copies and no lifecycle moves while retired.</li>
                <li>Takes the approved snapshot out of PROD — PROD can no longer run this procedure.</li>
                <li>Snapshots keep their states. Restoring brings the approved one back.</li>
              </>
            )}
          </ul>
          <div className="grid gap-1.5">
            <Label htmlFor="retire-reason">Reason (required, recorded in the audit trail)</Label>
            <Textarea id="retire-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} autoFocus placeholder={retired ? "Why is it coming back?" : "Why is it being retired?"} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" variant={retired ? "default" : "destructive"} disabled={!valid || pending}>
              {pending && <Loader2 className="animate-spin" data-icon="inline-start" />}
              {retired ? "Restore procedure" : "Retire procedure"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
