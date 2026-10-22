import type { SnapshotState } from "@/lib/lifecycle";
import type { Mission } from "@/lib/data/types";

/** Serialisable data the IDE routes hand to client components (no storage paths ever leave the server). */

export interface IdePerson {
  id: string;
  displayName: string;
  initials: string;
  color: string;
}

export interface IdeProcedure {
  id: string;
  name: string;
  mission: Mission;
  folder: string;
  retiredAt: string | null;
  retiredReason: string | null;
  activeSnapshotId: string | null;
}

export interface IdeSnapshot {
  id: string;
  number: number;
  state: SnapshotState;
  author: IdePerson;
  parentId: string | null;
  parentNumber: number | null;
  sha: string | null;
  summary: string | null;
  updatedAt: string;
}

/** A frozen snapshot's code, used as the other side of a diff. */
export interface IdeCodeRef {
  id: string;
  number: number;
  sha: string | null;
  code: string;
}

export interface IdeHistoryEntry {
  id: string;
  number: number;
  state: SnapshotState;
  author: IdePerson;
  sha: string | null;
  summary: string | null;
  submittedAt: string | null;
  updatedAt: string;
  parentNumber: number | null;
  isActive: boolean;
  isCurrent: boolean;
}

export interface EditorPageData {
  me: IdePerson;
  procedure: IdeProcedure;
  snapshot: IdeSnapshot;
  /** the draft as stored on the server */
  code: string;
  parent: IdeCodeRef | null;
  active: IdeCodeRef | null;
  history: IdeHistoryEntry[];
  bifrostEnabled: boolean;
}

export type EditBlock =
  | { kind: "ok" }
  | { kind: "frozen"; reason: string }
  | { kind: "not_author"; reason: string };

export interface EditLoad {
  block: EditBlock;
  data: EditorPageData;
}

export interface RunPageData {
  me: IdePerson;
  procedure: IdeProcedure;
  snapshot: IdeSnapshot;
  code: string;
  /** the viewer's own working copy: run it from the editor instead */
  ownDraft: boolean;
  bifrostEnabled: boolean;
}
