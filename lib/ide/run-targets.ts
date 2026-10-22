import type { ComponentType } from "react";
import { BIFROST_TARGET } from "../../components/mos/ide-bifrost/target";
import {
  useProcedureRun,
  type ProcedureRunApi,
} from "../sandbox/use-procedure-run";
import type { Mission } from "../sandbox/types";

/**
 * Where a procedure runs. Every target exposes the same state/controls (`ProcedureRunApi`) and emits the same
 * RunEvent shapes (lib/sandbox/types.ts), so the arguments form, inspector, console and timeline do not care
 * which one is active. The Bifrost (Jatayu SILS) target lives in components/mos/ide-bifrost/target.ts.
 *
 * `useRun` is a React hook (it owns the target's state); the workspace mounts exactly one target per session
 * (keyed by id), so hook order is stable.
 */
export interface RunTarget {
  id: "mock" | "bifrost";
  /** shown in the target selector */
  label: string;
  hint: string;
  /** stored in runs.target */
  recordedAs: "mock" | "bifrost";
  capabilities: { warp: boolean; faults: boolean; inspector: boolean };
  availability(
    ctx: RunTargetContext,
  ): { available: true } | { available: false; reason: string };
  useRun(): ProcedureRunApi;
  /** Optional target-specific controls the Run panel renders under the target selector (e.g. the Bifrost sim picker). */
  Panel?: ComponentType;
}

export interface RunTargetContext {
  mission: Mission;
  bifrostEnabled: boolean;
}

export const MOCK_TARGET: RunTarget = {
  id: "mock",
  label: "Mock spacecraft",
  hint: "In-browser Python (Pyodide) against a simulated spacecraft with a virtual clock",
  recordedAs: "mock",
  capabilities: { warp: true, faults: true, inspector: true },
  availability: () => ({ available: true }),
  useRun: useProcedureRun,
};

const registry = new Map<RunTarget["id"], RunTarget>([
  ["mock", MOCK_TARGET],
  ["bifrost", BIFROST_TARGET],
]);

export function registerRunTarget(target: RunTarget): void {
  registry.set(target.id, target);
}

export function listRunTargets(): RunTarget[] {
  return [...registry.values()];
}

export function getRunTarget(id: RunTarget["id"]): RunTarget {
  return registry.get(id) ?? MOCK_TARGET;
}

/** Targets the user can pick right now. */
export function usableTargets(ctx: RunTargetContext): RunTarget[] {
  return listRunTargets().filter((t) => t.availability(ctx).available);
}
