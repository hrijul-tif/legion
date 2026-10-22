"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { IdePerson } from "@/lib/ide/types";
import { PRESENCE_CHANNEL, type PresenceMeta } from "@/lib/ide/presence";

export interface PresenceState {
  /** other people in this procedure (one entry per person) */
  others: PresenceMeta[];
  /** the same user editing the same working copy in another tab */
  otherTabs: PresenceMeta[];
  /** people editing this exact working copy */
  sameCopy: PresenceMeta[];
  connected: boolean;
}

const EMPTY: PresenceState = {
  others: [],
  otherTabs: [],
  sameCopy: [],
  connected: false,
};

/** Supabase Realtime presence on `procedure:<id>`: how MOS stops two people silently editing the same procedure. */
export function usePresence(opts: {
  procedureId: string;
  me: IdePerson;
  snapshotId: string;
  number: number;
  enabled: boolean;
}): PresenceState {
  const { procedureId, me, snapshotId, number, enabled } = opts;
  const [metas, setMetas] = useState<PresenceMeta[]>([]);
  const [connected, setConnected] = useState(false);
  const [tabId] = useState(() =>
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : String(Math.random()).slice(2),
  );

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let cleanup: (() => void) | undefined;
    try {
      const supabase = createClient();
      const channel = supabase.channel(PRESENCE_CHANNEL(procedureId), {
        config: { presence: { key: `${me.id}:${tabId}` } },
      });
      const sync = () => {
        if (cancelled) return;
        const state = channel.presenceState<PresenceMeta>();
        setMetas(
          Object.values(state).flatMap((list) => list.map((m) => ({ ...m }))),
        );
      };
      channel
        .on("presence", { event: "sync" }, sync)
        .on("presence", { event: "join" }, sync)
        .on("presence", { event: "leave" }, sync)
        .subscribe(async (status) => {
          if (cancelled) return;
          setConnected(status === "SUBSCRIBED");
          if (status === "SUBSCRIBED") {
            const meta: PresenceMeta = {
              userId: me.id,
              name: me.displayName,
              initials: me.initials,
              color: me.color,
              snapshotId,
              number,
              mode: "editing",
              tabId,
              at: Date.now(),
            };
            await channel.track(meta);
          }
        });
      cleanup = () => {
        void channel.untrack();
        void supabase.removeChannel(channel);
      };
    } catch {
      // realtime unavailable (missing env, offline): presence is a courtesy, never a blocker
    }
    return () => {
      cancelled = true;
      cleanup?.();
      setMetas([]);
      setConnected(false);
    };
  }, [
    enabled,
    procedureId,
    me.id,
    me.displayName,
    me.initials,
    me.color,
    snapshotId,
    number,
    tabId,
  ]);

  return useMemo(() => {
    if (!metas.length) return { ...EMPTY, connected };
    const otherTabs = metas.filter(
      (m) =>
        m.userId === me.id && m.tabId !== tabId && m.snapshotId === snapshotId,
    );
    const byUser = new Map<string, PresenceMeta>();
    for (const m of metas) {
      if (m.userId === me.id) continue;
      const prev = byUser.get(m.userId);
      // prefer the entry that is on this working copy, then the newest
      if (
        !prev ||
        (m.snapshotId === snapshotId && prev.snapshotId !== snapshotId) ||
        (prev.snapshotId !== snapshotId && m.at > prev.at)
      )
        byUser.set(m.userId, m);
    }
    const others = [...byUser.values()].sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    return {
      others,
      otherTabs,
      sameCopy: others.filter((m) => m.snapshotId === snapshotId),
      connected,
    };
  }, [metas, me.id, tabId, snapshotId, connected]);
}
