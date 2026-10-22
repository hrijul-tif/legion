"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { format, formatDistanceToNowStrict } from "date-fns";

const noopSubscribe = () => () => {};

/** Relative time that stays fresh; full timestamp on hover. Renders absolute on the server to avoid hydration drift. */
export function RelativeTime({ date, className, addSuffix = true }: { date: string | Date | null | undefined; className?: string; addSuffix?: boolean }) {
  const [, tick] = useState(0);
  const mounted = useSyncExternalStore(noopSubscribe, () => true, () => false);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);
  if (!date) return <span className={className}>—</span>;
  const d = typeof date === "string" ? new Date(date) : date;
  const abs = format(d, "d MMM yyyy, HH:mm:ss");
  return (
    <time dateTime={d.toISOString()} title={abs} className={className} suppressHydrationWarning>
      {mounted ? formatDistanceToNowStrict(d, { addSuffix }) : format(d, "d MMM, HH:mm")}
    </time>
  );
}

export function AbsoluteTime({ date, className, fmt = "d MMM yyyy, HH:mm" }: { date: string | Date | null | undefined; className?: string; fmt?: string }) {
  if (!date) return <span className={className}>—</span>;
  const d = typeof date === "string" ? new Date(date) : date;
  return (
    <time dateTime={d.toISOString()} className={className} suppressHydrationWarning>
      {format(d, fmt)}
    </time>
  );
}
