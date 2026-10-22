"use client";

import { useTransition } from "react";
import { debounce, useQueryStates } from "nuqs";
import { ArrowDownUp, FolderTree, Loader2, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { procedureParsers, SORT_LABELS, SORTS, STATUS_FILTER_META, STATUS_FILTERS, type ProcedureSort, type StatusFilter } from "./search-params";

const ALL = "__all";

export function useProcedureFilters() {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useQueryStates(procedureParsers, { shallow: false, clearOnDefault: true, startTransition });
  return { state, setState, pending };
}

export function ProcedureFilters({ folders }: { folders: string[] }) {
  const { state, setState, pending } = useProcedureFilters();

  const toggleStatus = (s: StatusFilter) => {
    const next = state.status.includes(s) ? state.status.filter((x) => x !== s) : [...state.status, s];
    void setState({ status: next, page: 1 });
  };

  return (
    <div className="space-y-3" role="search">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={state.q}
            onChange={(e) => void setState({ q: e.target.value, page: 1 }, { limitUrlUpdates: e.target.value === "" ? undefined : debounce(300) })}
            placeholder="Search name, folder or description"
            aria-label="Search procedures"
            className="pl-8"
          />
        </div>

        <ToggleGroup
          type="single"
          variant="outline"
          value={state.mission ?? ALL}
          onValueChange={(v) => void setState({ mission: v === "FF" || v === "JTYU" ? v : null, page: 1 })}
          aria-label="Mission"
        >
          <ToggleGroupItem value={ALL} className="px-3">All</ToggleGroupItem>
          <ToggleGroupItem value="FF" className="px-3">FF</ToggleGroupItem>
          <ToggleGroupItem value="JTYU" className="px-3">JTYU</ToggleGroupItem>
        </ToggleGroup>

        <Select value={state.area ?? ALL} onValueChange={(v) => void setState({ area: v === ALL ? null : v, page: 1 })}>
          <SelectTrigger aria-label="Folder" className="min-w-36">
            <FolderTree className="text-muted-foreground" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All folders</SelectItem>
            {folders.map((f) => (
              <SelectItem key={f} value={f} className="font-mono">
                {f}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="ml-auto flex items-center gap-2">
          {pending && <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Updating" />}
          <Select value={state.sort} onValueChange={(v) => void setState({ sort: v as ProcedureSort })}>
            <SelectTrigger aria-label="Sort by">
              <ArrowDownUp className="text-muted-foreground" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              {SORTS.map((s) => (
                <SelectItem key={s} value={s}>
                  {SORT_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {STATUS_FILTERS.map((s) => {
          const on = state.status.includes(s);
          return (
            <button
              key={s}
              type="button"
              aria-pressed={on}
              title={STATUS_FILTER_META[s].hint}
              onClick={() => toggleStatus(s)}
              className={cn(
                "inline-flex h-7 items-center rounded-full border px-3 text-xs font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                on ? "border-primary/40 bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {STATUS_FILTER_META[s].label}
            </button>
          );
        })}
        {(state.q || state.mission || state.area || state.status.length > 0) && (
          <Button variant="ghost" size="xs" onClick={() => void setState({ q: "", mission: null, area: null, status: [], page: 1 })}>
            <X /> Clear
          </Button>
        )}
      </div>
    </div>
  );
}
