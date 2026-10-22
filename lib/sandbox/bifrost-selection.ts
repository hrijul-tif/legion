'use client';

/** The Bifrost simulation the operator attached to (shared by the run hook and the picker). Survives reloads per tab. */
import { useSyncExternalStore } from 'react';

const KEY = 'mos.bifrost.sim';
let current: string | null = null;
let loaded = false;
const listeners = new Set<() => void>();

function load() {
  if (loaded) return;
  loaded = true;
  try {
    current = sessionStorage.getItem(KEY);
  } catch {
    current = null;
  }
}

export function getAttachedSim(): string | null {
  load();
  return current;
}

export function setAttachedSim(simId: string | null) {
  load();
  current = simId;
  try {
    if (simId) sessionStorage.setItem(KEY, simId);
    else sessionStorage.removeItem(KEY);
  } catch {
    // storage unavailable: the selection just lives in memory
  }
  listeners.forEach((l) => l());
}

export function useAttachedSim(): string | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    getAttachedSim,
    () => null,
  );
}

/** The snapshot being run: /snapshots/<uuid>/edit|run (the run hook has no other way to learn it). */
export function snapshotIdFromLocation(): string | null {
  const m = /\/snapshots\/([0-9a-f-]{36})(?:\/|$)/i.exec(window.location.pathname);
  return m ? m[1] : null;
}
