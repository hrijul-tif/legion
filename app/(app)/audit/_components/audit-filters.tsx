"use client";

import { CalendarRange, Download, FilterX, GitBranch, ListFilter, Rocket, UserRound } from "lucide-react";
import { createSerializer } from "nuqs";
import { AUDIT_KIND_OPTIONS, auditParsers } from "@/components/mos/tables/audit-params";
import { MultiSelect, type MultiSelectOption } from "@/components/mos/tables/multi-select";
import { UserAvatar } from "@/components/mos/user-avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { useAudit } from "./audit-context";

export interface AuditProcedureOption {
  id: string;
  name: string;
  folder: string;
}
export interface AuditActorOption {
  id: string;
  name: string;
  initials: string;
  color: string;
}

const serializeExport = createSerializer(auditParsers);

export function AuditFilters({ procedures, actors }: { procedures: AuditProcedureOption[]; actors: AuditActorOption[] }) {
  const { params, update, reset } = useAudit();
  const procOptions: MultiSelectOption[] = procedures.map((p) => ({ value: p.id, label: p.name, hint: p.folder || undefined }));
  const actorOptions: MultiSelectOption[] = actors.map((a) => ({
    value: a.id,
    label: a.name,
    leading: <UserAvatar user={{ displayName: a.name, initials: a.initials, color: a.color }} size={18} />,
  }));
  const kindOptions: MultiSelectOption[] = AUDIT_KIND_OPTIONS.map((k) => ({ value: k.value, label: k.label, group: k.group }));
  const hasDates = !!params.from || !!params.to;
  const dirty = params.proc.length > 0 || params.actor.length > 0 || params.kind.length > 0 || hasDates || params.prod;
  const exportHref = serializeExport("/api/audit/export", { proc: params.proc, actor: params.actor, kind: params.kind, from: params.from, to: params.to, prod: params.prod });

  return (
    <div className="flex flex-wrap items-center gap-2">
      <MultiSelect label="Procedure" icon={<GitBranch className="size-3.5" />} options={procOptions} selected={params.proc} onChange={(v) => update({ proc: v.length ? v : null })} searchPlaceholder="Find a procedure…" />
      <MultiSelect label="Actor" icon={<UserRound className="size-3.5" />} options={actorOptions} selected={params.actor} onChange={(v) => update({ actor: v.length ? v : null })} searchPlaceholder="Find a person…" />
      <MultiSelect label="Event" icon={<ListFilter className="size-3.5" />} options={kindOptions} selected={params.kind} onChange={(v) => update({ kind: v.length ? v : null })} searchPlaceholder="Filter events…" />

      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className={cn("h-8 gap-1.5 font-normal", hasDates && "border-primary/40 bg-primary/5")}>
            <CalendarRange className="size-3.5" />
            {hasDates ? `${params.from ?? "…"} → ${params.to ?? "…"}` : "Date range"}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="audit-from" className="text-xs">
                From (UTC day)
              </Label>
              <Input id="audit-from" type="date" value={params.from ?? ""} max={params.to ?? undefined} onChange={(e) => update({ from: e.target.value || null })} className="h-8" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="audit-to" className="text-xs">
                To (UTC day)
              </Label>
              <Input id="audit-to" type="date" value={params.to ?? ""} min={params.from ?? undefined} onChange={(e) => update({ to: e.target.value || null })} className="h-8" />
            </div>
          </div>
          {hasDates && (
            <Button variant="ghost" size="sm" onClick={() => update({ from: null, to: null })}>
              Clear dates
            </Button>
          )}
        </PopoverContent>
      </Popover>

      <label className={cn("inline-flex h-8 cursor-pointer items-center gap-2 rounded-lg border px-2.5 text-xs font-medium", params.prod && "border-tone-warn/40 bg-tone-warn/10 text-tone-warn")}>
        <Switch size="sm" checked={params.prod} onCheckedChange={(v) => update({ prod: v || null })} aria-label="Production changes only" />
        <Rocket className="size-3.5" />
        Production changes only
      </label>

      {dirty && (
        <Button variant="ghost" size="sm" className="h-8 text-muted-foreground" onClick={reset}>
          <FilterX /> Clear
        </Button>
      )}

      <Button asChild variant="outline" size="sm" className="ml-auto h-8">
        <a href={exportHref} download>
          <Download /> Export CSV
        </a>
      </Button>
    </div>
  );
}
