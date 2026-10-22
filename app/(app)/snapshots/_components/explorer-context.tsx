"use client";

import { createContext, useContext, useTransition } from "react";
import { debounce, useQueryStates } from "nuqs";
import { snapshotParsers } from "@/components/mos/tables/snapshot-params";

type Params = ReturnType<typeof useQueryStates<typeof snapshotParsers>>;
type State = Params[0];
export type ExplorerPatch = Partial<{ [K in keyof State]: State[K] | null }>;

interface ExplorerCtx {
  params: State;
  pending: boolean;
  /** Merge a patch into the URL. Anything other than a page change resets to page 1. */
  update: (patch: ExplorerPatch, opts?: { debounced?: boolean }) => void;
  reset: () => void;
}

const Ctx = createContext<ExplorerCtx | null>(null);

export const CLEARED: ExplorerPatch = { q: null, proc: null, state: null, author: null, mission: null, active: null, field: null, from: null, to: null, page: null };

export function ExplorerProvider({ children }: { children: React.ReactNode }) {
  const [pending, startTransition] = useTransition();
  const [params, setParams] = useQueryStates(snapshotParsers, { shallow: false, startTransition });
  const value: ExplorerCtx = {
    params,
    pending,
    update: (patch, opts) => {
      const next = "page" in patch ? patch : { ...patch, page: null };
      void setParams(next as Parameters<typeof setParams>[0], opts?.debounced ? { limitUrlUpdates: debounce(300) } : undefined);
    },
    reset: () => void setParams(CLEARED as Parameters<typeof setParams>[0]),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useExplorer(): ExplorerCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useExplorer must be used inside ExplorerProvider");
  return v;
}
