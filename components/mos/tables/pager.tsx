"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

function PageJump({ page, pageCount, onJump }: { page: number; pageCount: number; onJump: (p: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    const n = Number(draft);
    setDraft(null);
    if (Number.isInteger(n) && n >= 1 && n <= pageCount && n !== page) onJump(n);
  };
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      Page
      <Input
        aria-label="Jump to page"
        inputMode="numeric"
        value={draft ?? String(page)}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setDraft(e.target.value.replace(/\D/g, ""))}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") setDraft(null);
        }}
        className="tabular h-7 w-12 px-1 text-center text-xs"
      />
      of <span className="tabular">{pageCount}</span>
    </span>
  );
}

/** Rows-per-page select, prev/next and a page jump box. Page numbers are 1-based. */
export function Pager({
  page,
  pageCount,
  size,
  sizes,
  onPage,
  onSize,
}: {
  page: number;
  pageCount: number;
  size: number;
  sizes: readonly number[];
  onPage: (page: number) => void;
  onSize: (size: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-2">
        Rows per page
        <Select value={String(size)} onValueChange={(v) => onSize(Number(v))}>
          <SelectTrigger size="sm" className="h-7 w-16 text-xs" aria-label="Rows per page">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {sizes.map((s) => (
              <SelectItem key={s} value={String(s)}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </span>
      <span className="inline-flex items-center gap-2">
        <Button variant="outline" size="icon-sm" aria-label="Previous page" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          <ChevronLeft />
        </Button>
        <PageJump key={page} page={page} pageCount={pageCount} onJump={onPage} />
        <Button variant="outline" size="icon-sm" aria-label="Next page" disabled={page >= pageCount} onClick={() => onPage(page + 1)}>
          <ChevronRight />
        </Button>
      </span>
    </div>
  );
}
