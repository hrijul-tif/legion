"use client";

import { motion, useReducedMotion } from "motion/react";
import { History } from "lucide-react";
import { TONE_CLASSES } from "@/components/mos/state-badge";
import { cn } from "@/lib/utils";
import { STATE_META } from "@/lib/lifecycle";
import type { SnapshotPageData } from "@/lib/data/snapshot";
import { EmptyNote } from "./bits";
import { TransitionItem } from "./timeline";

/** Every state change of this snapshot, oldest first, from the append-only audit trail. */
export function HistoryTab({ data }: { data: SnapshotPageData }) {
  const reduce = useReducedMotion();
  const rows = data.transitions.filter((t) => t.snapshot_id === data.snapshot.id);

  if (rows.length === 0) {
    return (
      <EmptyNote icon={<History />} title="No history yet">
        Every state change of this snapshot will be listed here with who made it, when, and why.
      </EmptyNote>
    );
  }

  return (
    <div>
      <p className="mb-4 text-[13px] text-muted-foreground">
        {rows.length} entr{rows.length === 1 ? "y" : "ies"} in the append-only audit trail. Nothing here can be edited or deleted.
      </p>
      <ol className="relative space-y-0">
        {rows.map((t, i) => {
          const tone = TONE_CLASSES[STATE_META[t.to_state].tone];
          const last = i === rows.length - 1;
          return (
            <motion.li
              key={t.id}
              initial={reduce ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, delay: Math.min(i * 0.03, 0.25) }}
              className="relative grid grid-cols-[1.5rem_minmax(0,1fr)] gap-3 pb-6"
            >
              <span className="relative flex justify-center">
                {!last && <span className="absolute top-4 bottom-[-1.5rem] w-px bg-border" aria-hidden />}
                <span className={cn("mt-1.5 size-3 rounded-full border-2 border-background ring-1", tone.dot, "ring-border")} aria-hidden />
              </span>
              <div className="rounded-xl border bg-card px-4 py-3">
                <TransitionItem t={t} d={data} />
              </div>
            </motion.li>
          );
        })}
      </ol>
    </div>
  );
}
