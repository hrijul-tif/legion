/** Shapes exchanged between the Bifrost REST API, our /api/bifrost routes and the UI. */

export type SimLifecycleState = "INITIALIZING" | "RUNNING" | "COMPLETED" | "FAILED" | "STOPPING" | "STOPPED";

export interface SimListItem {
  sim_id: string;
  /** coarse status of the list endpoint (PROGRESS, RUNNING, COMPLETED, ...) */
  status: string;
  run_name: string | null;
}

export interface SimComponent {
  source?: string;
  state: string;
  phase: string | null;
  reference?: string;
  error: { code: string; message: string; component?: string } | null;
}

/** GET .../simulations/{sim_id} (exact lifecycle) plus what we derive from it. */
export interface SimStatus {
  simulation_id: string;
  run_name?: string | null;
  state: SimLifecycleState;
  phase: string | null;
  cancellation_requested?: boolean;
  components?: Record<string, SimComponent>;
  error: { code: string; message: string; component?: string } | null;
  updated_at?: string;
  /** seconds of simulated time elapsed / percent complete, when the progress endpoint answers */
  progress?: { percent: number; elapsed: number } | null;
  /** YAMCS address (no scheme) of this run, e.g. bifrost.pixxel.space/yamcs/<session> */
  yamcs: string;
  session: string;
}

export interface SimsResponse {
  workspace: string;
  sims: SimListItem[];
}

export interface OverrideManifest {
  version?: number;
  source?: string;
  modes: { name: string; value: string }[];
  targets: Record<
    string,
    {
      kind: string;
      typeName?: string;
      typeDefault?: unknown;
      fields: { path: string; kind: string; default?: unknown }[];
    }
  >;
}

export interface FailureCommand {
  type: "messageOverride" | "clearMessageOverride" | "clearAllMessageOverrides";
  target?: string;
  mode?: "replace" | "freeze";
  value?: Record<string, unknown> | string[];
  startTimeSec?: number;
  afterSec?: number;
  durationSec?: number;
  ruleId?: number;
}

/** A sim is attachable when its lifecycle says RUNNING. */
export const isAttachable = (state: string) => state === "RUNNING";
