"use client";

import { CalendarRange, FilterX, GitBranch, Rocket, Search, ShieldAlert, UserRound, Users, Workflow, X } from "lucide-react";
import { MultiSelect, type MultiSelectOption } from "@/components/mos/tables/multi-select";
import { FAILED_STATES, PIPELINE_STATES, STATE_GROUPS } from "@/components/mos/tables/snapshot-params";
import { TONE_CLASSES } from "@/components/mos/state-badge";
import { UserAvatar } from "@/components/mos/user-avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { STATE_META, type SnapshotState } from "@/lib/lifecycle";
import { cn } from "@/lib/utils";
import { useExplorer, type ExplorerPatch } from "./explorer-context";

export interface ProcedureOption {
  id: string;
  name: string;
  folder: string;
}
export interface AuthorOption {
  id: string;
  name: string;
  initials: string;
  color: string;
}

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && b.every((x) => a.includes(x));

interface QuickView {
  id: string;
  label: string;
  icon: React.ReactNode;
  patch: ExplorerPatch;
  matches: (p: ReturnType<typeof useExplorer>["params"], me: string) => boolean;
}

function quickViews(me: string): QuickView[] {
  return [
    {
      id: "prod",
      label: "Everything in PROD",
      icon: <Rocket />,
      patch: { active: true },
      matches: (p) => p.active && p.state.length === 0 && p.author.length === 0,
    },
    {
      id: "pipeline",
      label: "In the pipeline",
      icon: <Workflow />,
      patch: { state: PIPELINE_STATES },
      matches: (p) => sameSet(p.state, PIPELINE_STATES) && !p.active && p.author.length === 0,
    },
    {
      id: "failed",
      label: "Failed",
      icon: <ShieldAlert />,
      patch: { state: FAILED_STATES },
      matches: (p) => sameSet(p.state, FAILED_STATES) && !p.active && p.author.length === 0,
    },
    {
      id: "mine",
      label: "My snapshots",
      icon: <UserRound />,
      patch: { author: [me] },
      matches: (p) => sameSet(p.author, [me]) && p.state.length === 0 && !p.active,
    },
  ];
}

export function ExplorerFilters({ procedures, authors, me }: { procedures: ProcedureOption[]; authors: AuthorOption[]; me: string }) {
  const { params, update, reset } = useExplorer();
  const views = quickViews(me);
  const activeView = views.find((v) => v.matches(params, me) && !params.q && params.proc.length === 0 && !params.mission && !params.from && !params.to);

  const procOptions: MultiSelectOption[] = procedures.map((p) => ({ value: p.id, label: p.name, hint: p.folder || undefined }));
  const authorOptions: MultiSelectOption[] = authors.map((a) => ({
    value: a.id,
    label: a.id === me ? `${a.name} (you)` : a.name,
    leading: <UserAvatar user={{ displayName: a.name, initials: a.initials, color: a.color }} size={18} />,
  }));

  const dirty =
    !!params.q || params.proc.length > 0 || params.state.length > 0 || params.author.length > 0 || !!params.mission || params.active || !!params.from || !!params.to;
  const hasDates = !!params.from || !!params.to;

  const toggleState = (s: SnapshotState) => update({ state: params.state.includes(s) ? params.state.filter((x) => x !== s) : [...params.state, s] });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Saved views">
        <span className="mr-1 text-xs font-medium text-muted-foreground">Views</span>
        {views.map((v) => {
          const on = activeView?.id === v.id;
          return (
            <button
              key={v.id}
              type="button"
              aria-pressed={on}
              onClick={() => (on ? reset() : update({ ...{ q: null, proc: null, state: null, author: null, mission: null, active: null, from: null, to: null }, ...v.patch }))}
              className={cn(
                "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors [&_svg]:size-3.5",
                on ? "border-primary/50 bg-primary/10 text-foreground" : "text-muted-foreground hover:border-foreground/20 hover:text-foreground",
              )}
            >
              {v.icon}
              {v.label}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full min-w-56 sm:w-72">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={params.q}
            onChange={(e) => update({ q: e.target.value || null }, { debounced: true })}
            placeholder="Search procedure, summary or hash…"
            aria-label="Search snapshots"
            className="h-8 pr-7 pl-8"
          />
          {params.q && (
            <button type="button" aria-label="Clear search" onClick={() => update({ q: null })} className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground">
              <X className="size-3.5" />
            </button>
          )}
        </div>

        <MultiSelect label="Procedure" icon={<GitBranch className="size-3.5" />} options={procOptions} selected={params.proc} onChange={(proc) => update({ proc: proc.length ? proc : null })} searchPlaceholder="Find a procedure…" />
        <MultiSelect label="Author" icon={<Users className="size-3.5" />} options={authorOptions} selected={params.author} onChange={(author) => update({ author: author.length ? author : null })} searchPlaceholder="Find a person…" />

        <div role="radiogroup" aria-label="Mission" className="inline-flex h-8 items-center rounded-lg border p-0.5 text-xs">
          {([null, "FF", "JTYU"] as const).map((m) => (
            <button
              key={m ?? "all"}
              type="button"
              role="radio"
              aria-checked={params.mission === m}
              onClick={() => update({ mission: m })}
              className={cn("h-full rounded-md px-2.5 font-medium transition-colors", params.mission === m ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              {m ?? "All"}
            </button>
          ))}
        </div>

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className={cn("h-8 gap-1.5 font-normal", hasDates && "border-primary/40 bg-primary/5")}>
              <CalendarRange className="size-3.5" />
              {hasDates ? `${params.from ?? "…"} → ${params.to ?? "…"}` : "Date range"}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72">
            <div className="space-y-1.5">
              <Label className="text-xs">Filter by</Label>
              <Select value={params.field} onValueChange={(v) => update({ field: v as "changed" | "created" })}>
                <SelectTrigger size="sm" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="changed">State changed</SelectItem>
                  <SelectItem value="created">Created</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="snap-from" className="text-xs">
                  From
                </Label>
                <Input id="snap-from" type="date" value={params.from ?? ""} max={params.to ?? undefined} onChange={(e) => update({ from: e.target.value || null })} className="h-8" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="snap-to" className="text-xs">
                  To
                </Label>
                <Input id="snap-to" type="date" value={params.to ?? ""} min={params.from ?? undefined} onChange={(e) => update({ to: e.target.value || null })} className="h-8" />
              </div>
            </div>
            {hasDates && (
              <Button variant="ghost" size="sm" onClick={() => update({ from: null, to: null })}>
                Clear dates
              </Button>
            )}
          </PopoverContent>
        </Popover>

        <label className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-lg border px-2.5 text-xs font-medium">
          <Switch size="sm" checked={params.active} onCheckedChange={(v) => update({ active: v || null })} aria-label="Active only" />
          Active only
        </label>

        {dirty && (
          <Button variant="ghost" size="sm" className="h-8 text-muted-foreground" onClick={reset}>
            <FilterX /> Clear filters
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2" role="group" aria-label="State filter">
        {STATE_GROUPS.map((g) => (
          <div key={g.id} className="flex items-center gap-1.5">
            <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{g.label}</span>
            {g.states.map((s) => {
              const on = params.state.includes(s);
              const tone = TONE_CLASSES[STATE_META[s].tone];
              return (
                <button
                  key={s}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleState(s)}
                  title={STATE_META[s].description}
                  className={cn(
                    "inline-flex h-6 items-center gap-1.5 rounded-full border px-2 text-xs font-medium transition-colors",
                    on ? cn(tone.bg, tone.border, tone.text) : "border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  <span className={cn("size-1.5 rounded-full", on ? tone.dot : "bg-muted-foreground/40")} />
                  {STATE_META[s].short}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
