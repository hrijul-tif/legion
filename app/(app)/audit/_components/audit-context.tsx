"use client";

import { createContext, useContext, useTransition } from "react";
import { useQueryStates } from "nuqs";
import { auditParsers } from "@/components/mos/tables/audit-params";

type State = ReturnType<typeof useQueryStates<typeof auditParsers>>[0];
export type AuditPatch = Partial<{ [K in keyof State]: State[K] | null }>;

interface Ctx {
  params: State;
  pending: boolean;
  update: (patch: AuditPatch) => void;
  reset: () => void;
}

const AuditCtx = createContext<Ctx | null>(null);

export function AuditProvider({ children }: { children: React.ReactNode }) {
  const [pending, startTransition] = useTransition();
  const [params, setParams] = useQueryStates(auditParsers, { shallow: false, startTransition });
  const value: Ctx = {
    params,
    pending,
    update: (patch) => {
      const touchesList = Object.keys(patch).some((k) => k !== "page" && k !== "ip" && k !== "at");
      void setParams((touchesList && !("page" in patch) ? { ...patch, page: null } : patch) as Parameters<typeof setParams>[0]);
    },
    reset: () => void setParams({ proc: null, actor: null, kind: null, from: null, to: null, prod: null, page: null } as Parameters<typeof setParams>[0]),
  };
  return <AuditCtx.Provider value={value}>{children}</AuditCtx.Provider>;
}

export function useAudit(): Ctx {
  const v = useContext(AuditCtx);
  if (!v) throw new Error("useAudit must be used inside AuditProvider");
  return v;
}
