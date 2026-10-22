"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { SnapshotRef } from "@/components/mos/hash";
import { StateBadge } from "@/components/mos/state-badge";
import { RelativeTime } from "@/components/mos/time";
import { UserChip } from "@/components/mos/user-avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { SnapshotListRow } from "@/lib/data/types";
import { cn } from "@/lib/utils";
import type { SnapshotSortKey } from "./snapshot-params";

function SortHead({
  label,
  sortKey,
  sort,
  dir,
  onSort,
  className,
}: {
  label: string;
  sortKey?: SnapshotSortKey;
  sort?: SnapshotSortKey;
  dir?: "asc" | "desc";
  onSort?: (key: SnapshotSortKey) => void;
  className?: string;
}) {
  if (!sortKey || !onSort) return <TableHead className={cn("h-9 text-xs font-medium", className)}>{label}</TableHead>;
  const active = sort === sortKey;
  const Icon = !active ? ChevronsUpDown : dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <TableHead className={cn("h-9 text-xs font-medium", className)} aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" onClick={() => onSort(sortKey)} className={cn("-ml-1.5 inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-muted hover:text-foreground", active && "text-foreground")}>
        {label}
        <Icon className={cn("size-3", !active && "opacity-40")} />
      </button>
    </TableHead>
  );
}

/** Snapshot rows as a table. Data is server-paginated; this component only renders and reports sort intent. */
export function SnapshotTable({
  rows,
  sort,
  dir,
  onSort,
  className,
}: {
  rows: SnapshotListRow[];
  sort?: SnapshotSortKey;
  dir?: "asc" | "desc";
  onSort?: (key: SnapshotSortKey) => void;
  className?: string;
}) {
  const router = useRouter();
  return (
    <div className={cn("overflow-hidden rounded-xl border bg-card", className)}>
      <Table>
        <TableHeader className="bg-muted/30">
          <TableRow className="hover:bg-transparent">
            <SortHead label="Procedure" sortKey="name" sort={sort} dir={dir} onSort={onSort} className="pl-4" />
            <SortHead label="Snapshot" sortKey="number" sort={sort} dir={dir} onSort={onSort} />
            <SortHead label="State" />
            <SortHead label="Summary" className="hidden xl:table-cell" />
            <SortHead label="Author" className="hidden md:table-cell" />
            <SortHead label="Forked from" className="hidden 2xl:table-cell" />
            <SortHead label="State changed" sortKey="changed" sort={sort} dir={dir} onSort={onSort} className="pr-4 text-right" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow
              key={r.id}
              tabIndex={0}
              onClick={() => router.push(`/snapshots/${r.id}`)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && e.target === e.currentTarget) router.push(`/snapshots/${r.id}`);
              }}
              className={cn("cursor-pointer outline-none focus-visible:bg-muted/60", r.is_active && "shadow-[inset_2px_0_0_0_var(--color-tone-success)]")}
            >
              <TableCell className="max-w-64 pl-4">
                <Link href={`/procedures/${r.procedure_id}`} onClick={(e) => e.stopPropagation()} className="block truncate text-sm font-medium hover:underline">
                  {r.procedure_name}
                </Link>
                <span className="block truncate font-mono text-[11px] text-muted-foreground">
                  {r.mission !== "FF" && <span className="mr-1.5 rounded border px-1">{r.mission}</span>}
                  {r.folder || "/"}
                </span>
              </TableCell>
              <TableCell>
                <span className="inline-flex items-center gap-2">
                  <SnapshotRef number={r.number} sha={r.code_sha256} />
                  {r.is_active && <span className="rounded-full border border-tone-success/30 bg-tone-success/10 px-1.5 text-[10px] font-semibold tracking-wide text-tone-success uppercase">Active</span>}
                </span>
              </TableCell>
              <TableCell>
                <StateBadge state={r.state} size="xs" short showCode={false} />
              </TableCell>
              <TableCell className="hidden max-w-72 xl:table-cell">
                {r.summary ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="block truncate text-sm text-muted-foreground">{r.summary}</span>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-sm whitespace-pre-wrap">{r.summary}</TooltipContent>
                  </Tooltip>
                ) : (
                  <span className="text-muted-foreground/50">—</span>
                )}
              </TableCell>
              <TableCell className="hidden md:table-cell">
                <UserChip user={{ displayName: r.author_name, initials: r.author_initials, color: r.author_color }} />
              </TableCell>
              <TableCell className="hidden 2xl:table-cell">
                {r.parent_snapshot_id && r.parent_number !== null ? (
                  <Link href={`/snapshots/${r.parent_snapshot_id}`} onClick={(e) => e.stopPropagation()} className="font-mono text-sm tabular text-muted-foreground hover:text-foreground hover:underline">
                    #{r.parent_number}
                  </Link>
                ) : (
                  <span className="text-muted-foreground/50">—</span>
                )}
              </TableCell>
              <TableCell className="pr-4 text-right text-xs whitespace-nowrap text-muted-foreground">
                <RelativeTime date={r.state_changed_at ?? r.updated_at} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function SnapshotTableSkeleton({ rows = 10 }: { rows?: number }) {
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="h-9 border-b bg-muted/30" />
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-6 border-b px-4 py-2.5 last:border-0">
          <div className="w-56 space-y-1.5">
            <Skeleton className="h-3.5 w-40" />
            <Skeleton className="h-3 w-24" />
          </div>
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-5 w-24 rounded-full" />
          <Skeleton className="hidden h-4 flex-1 xl:block" />
          <Skeleton className="hidden h-5 w-28 md:block" />
          <Skeleton className="ml-auto h-4 w-16" />
        </div>
      ))}
    </div>
  );
}
