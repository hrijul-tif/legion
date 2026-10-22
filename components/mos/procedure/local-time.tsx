"use client";

import { useSyncExternalStore } from "react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

const noopSubscribe = () => () => {};

/** False during SSR/hydration, true afterwards — lets us render browser-timezone text without hydration mismatches. */
export function useMounted(): boolean {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}

export function LocalTime({ date, fmt = "d MMM yyyy, HH:mm", className }: { date: string | number | Date; fmt?: string; className?: string }) {
  const mounted = useMounted();
  const d = new Date(date);
  return (
    <time dateTime={d.toISOString()} className={cn(!mounted && "invisible", className)}>
      {mounted ? format(d, fmt) : d.toISOString().slice(0, 16)}
    </time>
  );
}
