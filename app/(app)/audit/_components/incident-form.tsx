"use client";

import { useState } from "react";
import { Clock, Search, Siren, X } from "lucide-react";
import { MultiSelect } from "@/components/mos/tables/multi-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAudit } from "./audit-context";
import type { AuditProcedureOption } from "./audit-filters";

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Incident lookup: pick a procedure and a moment; the server renders which snapshot was live and who cleared it. */
export function IncidentForm({ procedures, children }: { procedures: AuditProcedureOption[]; children: React.ReactNode }) {
  const { params, update } = useAudit();
  const [proc, setProc] = useState<string[]>(params.ip ? [params.ip] : []);
  const [when, setWhen] = useState(() => toLocalInput(params.at));
  const ready = proc.length === 1 && when !== "" && !Number.isNaN(new Date(when).getTime());

  return (
    <section aria-labelledby="incident-lookup" className="overflow-hidden rounded-xl border bg-card">
      <div className="relative border-b bg-grid px-4 py-4">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(closest-side,var(--glow),transparent)]" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-1">
            <h2 id="incident-lookup" className="flex items-center gap-2 text-sm font-semibold">
              <Siren className="size-4 text-tone-warn" /> Incident lookup
            </h2>
            <p className="max-w-xl text-xs text-muted-foreground">Something happened on a pass? Pick the procedure and the moment. We tell you which version ran, who reviewed it, who tested it and who cleared it for flight.</p>
          </div>
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (ready) update({ ip: proc[0], at: new Date(when).toISOString() });
            }}
          >
            <MultiSelect single label="Procedure" options={procedures.map((p) => ({ value: p.id, label: p.name, hint: p.folder || undefined }))} selected={proc} onChange={setProc} searchPlaceholder="Find a procedure…" />
            <div className="relative">
              <Clock className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input type="datetime-local" aria-label="When it ran (your local time)" value={when} onChange={(e) => setWhen(e.target.value)} suppressHydrationWarning className="h-8 w-52 pl-8" />
            </div>
            <Button type="submit" size="sm" className="h-8" disabled={!ready}>
              <Search /> Look up
            </Button>
            {(params.ip || params.at) && (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Clear lookup"
                onClick={() => {
                  setProc([]);
                  setWhen("");
                  update({ ip: null, at: null });
                }}
              >
                <X />
              </Button>
            )}
          </form>
        </div>
      </div>
      {children}
    </section>
  );
}
