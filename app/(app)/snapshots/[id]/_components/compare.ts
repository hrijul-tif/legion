"use client";

import { useEffect, useSyncExternalStore } from "react";
import type { ActionResult } from "@/app/actions/lifecycle";
import { loadSnapshotCode, type CompareCode } from "./actions";

type Result = ActionResult<CompareCode>;
export type CompareEntry = { status: "loading" } | { status: "ready"; result: Result };

/**
 * Code of other snapshots, memoised for the browser session. Frozen snapshots never change, so a successful
 * entry is valid forever. Exposed as a tiny external store so components never call a server action while rendering.
 */
const entries = new Map<string, CompareEntry>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};

export function ensureCompareCode(snapshotId: string): void {
  if (entries.has(snapshotId)) return;
  entries.set(snapshotId, { status: "loading" });
  loadSnapshotCode(snapshotId)
    .catch((e: unknown): Result => ({ ok: false, error: e instanceof Error ? e.message : String(e) }))
    .then((result) => {
      if (result.ok) entries.set(snapshotId, { status: "ready", result });
      else {
        // keep the failure visible once, then allow a retry on the next request
        entries.set(snapshotId, { status: "ready", result });
        setTimeout(() => {
          const cur = entries.get(snapshotId);
          if (cur?.status === "ready" && !cur.result.ok) {
            entries.delete(snapshotId);
            emit();
          }
        }, 5000);
      }
      emit();
    });
}

export function useCompareCode(snapshotId: string | null): CompareEntry | null {
  const entry = useSyncExternalStore(
    subscribe,
    () => (snapshotId ? entries.get(snapshotId) : undefined),
    () => undefined,
  );
  useEffect(() => {
    if (snapshotId && !entries.has(snapshotId)) ensureCompareCode(snapshotId);
  }, [snapshotId, entry]);
  return snapshotId ? (entry ?? { status: "loading" }) : null;
}

export function prefetchCompare(snapshotId: string | null | undefined): void {
  if (snapshotId) ensureCompareCode(snapshotId);
}

/** Seeds the cache (component previews and tests only). */
export function primeCompareCache(snapshotId: string, result: Result): void {
  entries.set(snapshotId, { status: "ready", result });
  emit();
}
