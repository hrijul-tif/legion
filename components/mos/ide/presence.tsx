"use client";

import { AlertTriangle } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { UserAvatar } from "@/components/mos/user-avatar";
import type { PresenceState } from "./use-presence";

/** Avatars of the other people in this procedure right now. Tooltip: who is editing which working copy. */
export function PresenceStack({ presence }: { presence: PresenceState }) {
  const { others } = presence;
  return (
    <div className="flex items-center" aria-label="People in this procedure">
      <div className="flex -space-x-1.5">
        <AnimatePresence initial={false}>
          {others.slice(0, 4).map((p) => (
            <motion.span
              key={p.userId}
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.6, opacity: 0 }}
              transition={{ type: "spring", stiffness: 500, damping: 30 }}
            >
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="relative inline-flex">
                    <UserAvatar
                      user={{
                        displayName: p.name,
                        initials: p.initials,
                        color: p.color,
                      }}
                      size={24}
                      ring
                    />
                    <span className="absolute -right-0.5 -bottom-0.5 size-2 rounded-full bg-tone-success ring-2 ring-background" />
                  </span>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  {p.name.split(" ")[0]} is editing working copy #{p.number}
                </TooltipContent>
              </Tooltip>
            </motion.span>
          ))}
        </AnimatePresence>
      </div>
      {others.length > 4 && (
        <span className="ml-1.5 text-[11px] text-muted-foreground">
          +{others.length - 4}
        </span>
      )}
    </div>
  );
}

/** Non-blocking heads-up when someone else (or you, in another tab) has this exact working copy open. */
export function CollisionBanner({ presence }: { presence: PresenceState }) {
  const sameCopy = presence.sameCopy;
  const otherTabs = presence.otherTabs;
  if (!sameCopy.length && !otherTabs.length) return null;
  return (
    <div
      role="status"
      className="flex shrink-0 items-center gap-2 border-b border-tone-warn/30 bg-tone-warn/[0.08] px-4 py-1.5 text-xs"
    >
      <AlertTriangle className="size-3.5 shrink-0 text-tone-warn" />
      <span>
        {sameCopy.length > 0 && (
          <>
            <strong className="font-medium">
              {sameCopy.map((p) => p.name.split(" ")[0]).join(", ")}
            </strong>{" "}
            {sameCopy.length === 1 ? "has" : "have"} this working copy open too.
            Edits are last-write-wins.
          </>
        )}
        {sameCopy.length > 0 && otherTabs.length > 0 && " "}
        {otherTabs.length > 0 && (
          <>
            You also have this working copy open in another tab; the last tab to
            save wins.
          </>
        )}
      </span>
    </div>
  );
}
