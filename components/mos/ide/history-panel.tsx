"use client";

import { ExternalLink, GitCompareArrows, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { StateBadge } from "@/components/mos/state-badge";
import { UserAvatar } from "@/components/mos/user-avatar";
import { RelativeTime } from "@/components/mos/time";
import { shortHash } from "@/lib/lifecycle";
import type { IdeHistoryEntry } from "@/lib/ide/types";

export function HistoryPanel({
  history,
  compareId,
  onCompare,
  onClearCompare,
}: {
  history: IdeHistoryEntry[];
  compareId: string | null;
  onCompare(entry: IdeHistoryEntry): void;
  onClearCompare(): void;
}) {
  return (
    <ul className="ide-scroll h-full overflow-y-auto pb-6">
      {history.map((h) => {
        const comparing = compareId === h.id;
        return (
          <li
            key={h.id}
            className={cn(
              "group border-b border-border/60 px-3 py-2.5 transition-colors",
              h.isCurrent ? "bg-primary/[0.06]" : "hover:bg-muted/40",
              comparing && "bg-tone-info/[0.07]",
            )}
          >
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm font-semibold tabular">
                #{h.number}
              </span>
              <StateBadge state={h.state} size="xs" short showCode={false} />
              {h.isActive && (
                <span className="inline-flex items-center gap-1 rounded-full border border-tone-success/30 bg-tone-success/10 px-1.5 text-[10px] font-medium text-tone-success">
                  <Globe className="size-2.5" /> PROD
                </span>
              )}
              {h.isCurrent && (
                <span className="rounded-full border px-1.5 text-[10px] text-muted-foreground">
                  this copy
                </span>
              )}
              <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                {shortHash(h.sha)}
              </span>
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <UserAvatar
                user={{
                  displayName: h.author.displayName,
                  initials: h.author.initials,
                  color: h.author.color,
                }}
                size={16}
              />
              <span className="truncate">{h.author.displayName}</span>
              <span aria-hidden>·</span>
              <RelativeTime date={h.submittedAt ?? h.updatedAt} />
              {h.parentNumber !== null && (
                <span className="ml-auto font-mono text-[10px]">
                  from #{h.parentNumber}
                </span>
              )}
            </div>
            {h.summary && (
              <p className="mt-1 line-clamp-2 text-xs leading-snug text-foreground/85">
                {h.summary}
              </p>
            )}
            <div className="mt-1.5 flex items-center gap-1">
              <Button
                asChild
                variant="ghost"
                size="xs"
                className="-ml-1.5 text-muted-foreground"
              >
                <a
                  href={`/snapshots/${h.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink /> Open
                </a>
              </Button>
              {!h.isCurrent &&
                (comparing ? (
                  <Button
                    variant="ghost"
                    size="xs"
                    className="text-tone-info"
                    onClick={onClearCompare}
                  >
                    <GitCompareArrows /> Comparing — stop
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="xs"
                    className="text-muted-foreground"
                    onClick={() => onCompare(h)}
                  >
                    <GitCompareArrows /> Compare with…
                  </Button>
                ))}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
