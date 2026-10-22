"use client";

import { ArrowDownUp, FilterX, SearchX } from "lucide-react";
import { EmptyState } from "@/components/mos/page-header";
import { Pager } from "@/components/mos/tables/pager";
import { SnapshotTable } from "@/components/mos/tables/snapshot-table";
import { PAGE_SIZES, SNAPSHOT_SORT_KEYS, type SnapshotSortKey } from "@/components/mos/tables/snapshot-params";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { SnapshotListRow } from "@/lib/data/types";
import { cn } from "@/lib/utils";
import { useExplorer } from "./explorer-context";

const SORT_LABELS: Record<SnapshotSortKey, string> = {
  changed: "State changed",
  created: "Created",
  name: "Procedure name",
  number: "Snapshot number",
};

export function ExplorerResults({ rows, total, page, pageCount }: { rows: SnapshotListRow[]; total: number; page: number; pageCount: number }) {
  const { params, pending, update, reset } = useExplorer();
  const size = params.size;
  const from = total === 0 ? 0 : (page - 1) * size + 1;
  const to = Math.min(total, (page - 1) * size + rows.length);

  const onSort = (key: SnapshotSortKey) => {
    if (params.sort === key) update({ dir: params.dir === "asc" ? "desc" : "asc" });
    else update({ sort: key, dir: key === "name" ? "asc" : "desc" });
  };

  return (
    <div className={cn("space-y-3 transition-opacity", pending && "opacity-60")} aria-busy={pending}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {total === 0 ? "No snapshots match" : <>Showing <span className="tabular text-foreground">{from}–{to}</span> of <span className="tabular text-foreground">{total.toLocaleString()}</span></>}
        </p>
        <div className="flex items-center gap-2">
          <Select value={params.sort} onValueChange={(v) => update({ sort: v as SnapshotSortKey, dir: v === "name" ? "asc" : "desc" })}>
            <SelectTrigger size="sm" className="h-8" aria-label="Sort by">
              <ArrowDownUp className="size-3.5 text-muted-foreground" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              {SNAPSHOT_SORT_KEYS.map((k) => (
                <SelectItem key={k} value={k}>
                  {SORT_LABELS[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" className="h-8" onClick={() => update({ dir: params.dir === "asc" ? "desc" : "asc" })} aria-label={`Sort direction: ${params.dir === "asc" ? "ascending" : "descending"}`}>
            {params.dir === "asc" ? "Asc" : "Desc"}
          </Button>
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState icon={<SearchX />} title={total > 0 ? "That page is past the end" : "No snapshots match these filters"}>
          {total > 0 ? "Go back to the first page to see results." : "Try widening the date range or removing a state filter."}
          <div className="mt-3 flex justify-center gap-2">
            {total > 0 && (
              <Button size="sm" variant="outline" onClick={() => update({ page: null })}>
                First page
              </Button>
            )}
            <Button size="sm" onClick={reset}>
              <FilterX /> Clear filters
            </Button>
          </div>
        </EmptyState>
      ) : (
        <SnapshotTable rows={rows} sort={params.sort} dir={params.dir} onSort={onSort} />
      )}

      {total > 0 && (
        <Pager
          page={page}
          pageCount={pageCount}
          size={size}
          sizes={PAGE_SIZES}
          onPage={(p) => update({ page: p <= 1 ? null : p })}
          onSize={(n) => update({ size: n as (typeof PAGE_SIZES)[number] })}
        />
      )}
    </div>
  );
}
