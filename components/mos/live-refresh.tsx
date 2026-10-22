"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Keeps every page live: any lifecycle change (by anyone) re-renders the server components.
 * Skipped inside the editor, where a refresh would only cost work — the IDE has its own presence channel.
 */
export function LiveRefresh() {
  const router = useRouter();
  const pathname = usePathname();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const paused = pathname.endsWith("/edit") || pathname.endsWith("/run");

  useEffect(() => {
    if (paused) return;
    const supabase = createClient();
    const schedule = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => router.refresh(), 400);
    };
    const channel = supabase
      .channel("mos-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "state_transitions" }, schedule)
      .on("postgres_changes", { event: "*", schema: "public", table: "procedure_events" }, schedule)
      .on("postgres_changes", { event: "*", schema: "public", table: "review_comments" }, schedule)
      .subscribe();
    return () => {
      if (timer.current) clearTimeout(timer.current);
      void supabase.removeChannel(channel);
    };
  }, [paused, router]);

  return null;
}
