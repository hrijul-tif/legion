/** Presence payload shared by everything that joins the `procedure:<id>` channel. */
export const PRESENCE_CHANNEL = (procedureId: string) =>
  `procedure:${procedureId}`;

export interface PresenceMeta {
  userId: string;
  name: string;
  initials: string;
  color: string;
  snapshotId: string;
  number: number;
  mode: "editing";
  /** one id per browser tab, so the same user in two tabs is recognisable */
  tabId: string;
  at: number;
}
