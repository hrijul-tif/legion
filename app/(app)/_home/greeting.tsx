"use client";

import { useSyncExternalStore } from "react";

function hello(): string {
  const h = new Date().getHours();
  if (h < 5) return "Burning the midnight oil";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

const subscribe = () => () => {};

/** Time-of-day greeting in the viewer's local time; neutral on the server to avoid hydration drift. */
export function Greeting({ name }: { name: string }) {
  const phrase = useSyncExternalStore(subscribe, hello, () => "Welcome back");
  return (
    <span>
      {phrase}, {name}
    </span>
  );
}
