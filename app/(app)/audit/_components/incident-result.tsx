import Link from "next/link";
import { AlertTriangle, ClipboardCheck, FlaskConical, PackageCheck, Rocket, ShieldCheck } from "lucide-react";
import { SnapshotRef } from "@/components/mos/hash";
import { LocalTime } from "@/components/mos/tables/local-time";
import { RelativeTime } from "@/components/mos/time";
import { UserAvatar } from "@/components/mos/user-avatar";
import type { IncidentResult, IncidentStep } from "@/lib/data/audit";
import { ACTION_VERBS, type SnapshotAction } from "@/lib/lifecycle";

function Answer({ icon, question, step, missing }: { icon: React.ReactNode; question: string; step: IncidentStep | null; missing: string }) {
  return (
    <div className="rounded-lg border bg-background/50 p-3">
      <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground [&_svg]:size-3.5">
        {icon}
        {question}
      </p>
      {step ? (
        <div className="mt-2 space-y-1">
          <p className="flex items-center gap-2 text-sm font-medium">
            <UserAvatar user={step.actor} size={22} />
            {step.actor.displayName}
          </p>
          <p className="text-xs text-muted-foreground">
            <LocalTime date={step.at} fmt="d MMM yyyy, HH:mm" /> · <RelativeTime date={step.at} />
          </p>
          {step.comment && <p className="line-clamp-2 border-l-2 pl-2 text-xs text-muted-foreground">{step.comment}</p>}
        </div>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">{missing}</p>
      )}
    </div>
  );
}

export function IncidentResultView({ result }: { result: IncidentResult }) {
  const a = result.active;
  return (
    <div className="space-y-3 p-4" aria-live="polite">
      <p className="text-sm">
        On <LocalTime date={result.at} fmt="d MMM yyyy 'at' HH:mm" className="font-medium" />,{" "}
        <Link href={`/procedures/${result.procedureId}`} className="font-medium hover:underline">
          {result.procedureName}
        </Link>{" "}
        {a ? "was running" : "had nothing approved."}
        {a && (
          <>
            {" "}
            <Link href={`/snapshots/${a.snapshotId}`} className="rounded px-1 hover:bg-muted">
              <SnapshotRef number={a.number} sha={a.sha} className="text-sm" />
            </Link>
            {a.viaRollback && <span className="ml-1.5 rounded-full border border-tone-warn/30 bg-tone-warn/10 px-1.5 text-[11px] font-medium text-tone-warn">after a rollback</span>}
          </>
        )}
      </p>
      {result.retiredAtTime && (
        <p className="flex items-center gap-2 rounded-lg border border-tone-danger/30 bg-tone-danger/10 px-3 py-2 text-xs text-tone-danger">
          <AlertTriangle className="size-3.5" /> The procedure was retired at that moment, so it should not have been run.
        </p>
      )}

      {a ? (
        <>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-lg border bg-background/50 p-3">
              <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground [&_svg]:size-3.5">
                <PackageCheck /> Which version ran?
              </p>
              <div className="mt-2 space-y-1">
                <Link href={`/snapshots/${a.snapshotId}`} className="inline-block text-sm hover:underline">
                  <SnapshotRef number={a.number} sha={a.sha} />
                </Link>
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <UserAvatar user={a.author} size={16} /> written by {a.author.displayName}
                </p>
                <p className="text-xs text-muted-foreground">
                  Live since <LocalTime date={a.activatedAt} fmt="d MMM, HH:mm" />
                </p>
              </div>
            </div>
            <Answer icon={<ClipboardCheck />} question="Who reviewed it?" step={a.reviewed} missing="No review is on record." />
            <Answer icon={<FlaskConical />} question="Who tested it?" step={a.tested} missing="No test sign-off is on record." />
            <Answer icon={<ShieldCheck />} question={a.viaRollback ? "Who reactivated it?" : "Who cleared it for flight?"} step={a.approved} missing="No approval is on record." />
          </div>
          <details className="group rounded-lg border bg-background/50 text-sm">
            <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-xs font-medium text-muted-foreground select-none hover:text-foreground">
              <Rocket className="size-3.5" /> Chain of custody for #{a.number} ({a.history.length} events up to that moment)
            </summary>
            <ol className="space-y-1.5 border-t px-3 py-2.5">
              {a.history.map((h, i) => (
                <li key={i} className="flex items-center gap-2 text-xs">
                  <UserAvatar user={h.actor} size={16} />
                  <span className="font-medium">{h.actor.displayName}</span>
                  <span className="text-muted-foreground">{ACTION_VERBS[h.action as SnapshotAction] ?? h.action}</span>
                  <LocalTime date={h.at} fmt="d MMM, HH:mm" className="ml-auto font-mono text-muted-foreground tabular" />
                </li>
              ))}
            </ol>
          </details>
        </>
      ) : (
        result.previous && (
          <p className="text-xs text-muted-foreground">
            The last snapshot approved before then was{" "}
            <Link href={`/snapshots/${result.previous.snapshotId}`} className="font-mono text-foreground hover:underline">
              #{result.previous.number}
            </Link>
            , but it had already been superseded or withdrawn.
          </p>
        )
      )}
    </div>
  );
}
