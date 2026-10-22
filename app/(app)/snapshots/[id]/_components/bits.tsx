"use client";

import Link from "next/link";
import { useState, useSyncExternalStore, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { SnapshotRef } from "@/components/mos/hash";
import { UserAvatar } from "@/components/mos/user-avatar";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { PersonLite } from "@/lib/data/snapshot";

/** Link to another snapshot: "#7 a1b2c3d". */
export function SnapLink({ id, number, sha, className }: { id: string; number: number; sha?: string | null; className?: string }) {
  return (
    <Link
      href={`/snapshots/${id}`}
      className={cn("rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/60", className)}
    >
      <SnapshotRef number={number} sha={sha} />
    </Link>
  );
}

export function Who({ user, className, size = 20 }: { user: Pick<PersonLite, "displayName" | "initials" | "color">; className?: string; size?: number }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 align-middle", className)}>
      <UserAvatar user={user} size={size} />
      <span className="truncate font-medium">{user.displayName}</span>
    </span>
  );
}

export function CopyButton({ text, label, className, children }: { text: string; label: string; className?: string; children?: ReactNode }) {
  const [done, setDone] = useState(false);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size={children ? "xs" : "icon-xs"}
          aria-label={label}
          className={className}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text);
              setDone(true);
              toast.success(`${label} — copied`);
              setTimeout(() => setDone(false), 1400);
            } catch {
              toast.error("Could not access the clipboard");
            }
          }}
        >
          {done ? <Check className="text-tone-success" /> : <Copy />}
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function SectionCard({
  title,
  icon,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn("rounded-xl border bg-card", className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b px-4 py-2.5">
          <h3 className="flex items-center gap-2 text-sm font-medium [&_svg]:size-4 [&_svg]:text-muted-foreground">
            {icon}
            {title}
          </h3>
          {actions && <div className="flex items-center gap-1.5">{actions}</div>}
        </header>
      )}
      <div className={cn("p-4", bodyClassName)}>{children}</div>
    </section>
  );
}

export function Pill({ tone, children, className, title }: { tone: "success" | "danger" | "warn" | "info" | "muted" | "neutral" | "progress"; children: ReactNode; className?: string; title?: string }) {
  const t = {
    success: "text-tone-success bg-tone-success/10 border-tone-success/30",
    danger: "text-tone-danger bg-tone-danger/10 border-tone-danger/25",
    warn: "text-tone-warn bg-tone-warn/10 border-tone-warn/25",
    info: "text-tone-info bg-tone-info/10 border-tone-info/25",
    progress: "text-tone-progress bg-tone-progress/10 border-tone-progress/25",
    muted: "text-tone-muted bg-tone-muted/10 border-tone-muted/20",
    neutral: "text-tone-neutral bg-tone-neutral/10 border-tone-neutral/25",
  }[tone];
  return (
    <span title={title} className={cn("inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full border px-2 text-xs font-medium whitespace-nowrap [&_svg]:size-3.5", t, className)}>
      {children}
    </span>
  );
}

export function EmptyNote({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-1.5 rounded-lg border border-dashed px-6 py-8 text-center">
      {icon && <div className="text-muted-foreground [&_svg]:size-6">{icon}</div>}
      <p className="text-sm font-medium">{title}</p>
      {children && <div className="max-w-sm text-xs text-muted-foreground">{children}</div>}
    </div>
  );
}

const noopSubscribe = () => () => undefined;
/** false during SSR and hydration, true afterwards. */
export function useIsClient(): boolean {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}

/** Renders children only in the browser (e.g. anything that calls a server action while rendering). */
export function ClientOnly({ children, fallback = null }: { children: ReactNode; fallback?: ReactNode }) {
  return useIsClient() ? <>{children}</> : <>{fallback}</>;
}

const pad = (n: number) => String(n).padStart(2, "0");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Timestamp in the viewer's local zone. Server and first client render show UTC so hydration always matches. */
export function LocalTime({ date, className, withYear = false }: { date: string; className?: string; withYear?: boolean }) {
  const client = useIsClient();
  const d = new Date(date);
  const text = client
    ? `${d.getDate()} ${MONTHS[d.getMonth()]}${withYear ? " " + d.getFullYear() : ""}, ${pad(d.getHours())}:${pad(d.getMinutes())}`
    : `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${withYear ? " " + d.getUTCFullYear() : ""}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
  return (
    <time dateTime={d.toISOString()} className={className} title={client ? d.toLocaleString() : undefined}>
      {text}
    </time>
  );
}
