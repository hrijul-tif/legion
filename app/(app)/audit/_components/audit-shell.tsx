"use client";

import { cn } from "@/lib/utils";
import { AuditProvider, useAudit } from "./audit-context";
import { AuditFilters, type AuditActorOption, type AuditProcedureOption } from "./audit-filters";
import { IncidentForm } from "./incident-form";

function Dim({ children }: { children: React.ReactNode }) {
  const { pending } = useAudit();
  return (
    <div className={cn("space-y-3 transition-opacity", pending && "opacity-60")} aria-busy={pending}>
      {children}
    </div>
  );
}

/** Owns the URL state. `incident` is the server-rendered lookup result; children are the server-rendered log rows. */
export function AuditShell({
  procedures,
  actors,
  incident,
  children,
}: {
  procedures: AuditProcedureOption[];
  actors: AuditActorOption[];
  incident: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <AuditProvider>
      <div className="space-y-6">
        <IncidentForm procedures={procedures}>{incident}</IncidentForm>
        <div className="space-y-3">
          <AuditFilters procedures={procedures} actors={actors} />
          <Dim>{children}</Dim>
        </div>
      </div>
    </AuditProvider>
  );
}
