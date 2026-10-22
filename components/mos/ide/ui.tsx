"use client";

import {
  useEffect,
  useLayoutEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const subscribeNoop = () => () => undefined;

/** false during SSR and hydration, true afterwards (for anything that reads localStorage / window). */
export function useIsClient(): boolean {
  return useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );
}

export function isMac(): boolean {
  return (
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
  );
}

/** "⌘" on macOS, "Ctrl" elsewhere. */
export function useModLabel(): string {
  const client = useIsClient();
  return client && isMac() ? "⌘" : "Ctrl";
}

export function Kbd({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "inline-flex h-4 min-w-4 items-center justify-center rounded-[4px] border border-border/70 bg-muted/70 px-1 font-mono text-[10px] leading-none text-muted-foreground",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

/** Tooltip around a single child; `keys` renders keyboard hints. */
export function Tip({
  label,
  keys,
  side = "bottom",
  children,
}: {
  label: ReactNode;
  keys?: string[];
  side?: "top" | "bottom" | "left" | "right";
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side} className="gap-2">
        <span>{label}</span>
        {keys && (
          <span className="flex gap-0.5">
            {keys.map((k) => (
              <Kbd
                key={k}
                className="border-background/20 bg-background/15 text-background"
              >
                {k}
              </Kbd>
            ))}
          </span>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

export function PanelHeader({
  title,
  actions,
  className,
  children,
}: {
  title: ReactNode;
  actions?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex h-9 shrink-0 items-center justify-between gap-2 border-b px-3",
        className,
      )}
    >
      <h2 className="truncate text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
        {title}
      </h2>
      {actions && (
        <div className="flex shrink-0 items-center gap-0.5">{actions}</div>
      )}
      {children}
    </div>
  );
}

/** Ticks once a second while mounted (relative times in the top bar). */
export function useNow(intervalMs = 15_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/**
 * Next.js hides inactive routes with React <Activity>: effects are cleaned up and, on return, re-run against
 * whatever is still mounted. @monaco-editor/react disposes its editor on cleanup and then calls `setModel` on the
 * disposed instance when its effects re-run, which throws. So Monaco is unmounted while the route is hidden
 * (layout-effect cleanup runs first) and mounted fresh when it comes back. Returns false while hidden.
 */
export function useMountedWhileVisible(): boolean {
  const [alive, setAlive] = useState(true);
  useLayoutEffect(() => {
    queueMicrotask(() => setAlive(true));
    return () => setAlive(false);
  }, []);
  return alive;
}
