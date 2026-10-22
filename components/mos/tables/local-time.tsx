"use client";

import { useSyncExternalStore } from "react";
import { format } from "date-fns";

const subscribe = () => () => {};

/** Absolute timestamp in the viewer's timezone. The server (and first paint) shows UTC so hydration never disagrees. */
export function LocalTime({ date, fmt = "d MMM yyyy, HH:mm:ss", className }: { date: string | Date; fmt?: string; className?: string }) {
  const local = useSyncExternalStore(subscribe, () => true, () => false);
  const d = typeof date === "string" ? new Date(date) : date;
  const text = local ? format(d, fmt) : `${d.toISOString().slice(0, 19).replace("T", " ")}Z`;
  return (
    <time dateTime={d.toISOString()} className={className} title={d.toISOString()}>
      {text}
    </time>
  );
}
