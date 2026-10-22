"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { OverrideManifest, SimStatus } from "@/lib/bifrost/types";

export interface SimRow extends SimStatus {
  run_name: string | null;
  listStatus: string;
}

export interface SimsState {
  sims: SimRow[];
  workspace: string | null;
  runnerReady: boolean;
  loading: boolean;
  error: string | null;
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, cache: "no-store", headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
  return json;
}

/** Polls the simulation list (fast while one is booting, slow otherwise) and exposes the actions of the picker. */
export function useBifrostSims() {
  const [state, setState] = useState<SimsState>({ sims: [], workspace: null, runnerReady: true, loading: true, error: null });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const r = await api<{ workspace: string; runnerReady: boolean; sims: SimRow[] }>("/api/bifrost/sims");
      if (alive.current) setState({ sims: r.sims, workspace: r.workspace, runnerReady: r.runnerReady, loading: false, error: null });
      return r.sims;
    } catch (e) {
      if (alive.current) setState((s) => ({ ...s, loading: false, error: e instanceof Error ? e.message : String(e) }));
      return null;
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    const tick = async () => {
      const sims = await refresh();
      if (!alive.current) return;
      const booting = sims?.some((s) => s.state === "INITIALIZING" || s.state === "STOPPING");
      timer.current = setTimeout(tick, booting ? 2500 : 8000);
    };
    void tick();
    return () => {
      alive.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [refresh]);

  const start = useCallback(async (): Promise<string> => {
    const r = await api<{ simId: string }>("/api/bifrost/sims", { method: "POST", body: JSON.stringify({ confirm: true, minutes: 30 }) });
    void refresh();
    return r.simId;
  }, [refresh]);

  const stop = useCallback(
    async (simId: string) => {
      await api(`/api/bifrost/sims/${encodeURIComponent(simId)}/stop`, { method: "POST" });
      void refresh();
    },
    [refresh],
  );

  return { ...state, refresh, start, stop };
}

export const loadManifest = (simId: string) => api<OverrideManifest>(`/api/bifrost/sims/${encodeURIComponent(simId)}/override-manifest`);
export const injectFault = (simId: string, failures: unknown) => api<{ message?: string }>(`/api/bifrost/sims/${encodeURIComponent(simId)}/failures`, { method: "POST", body: JSON.stringify({ failures }) });
