import { cn } from "@/lib/utils";

export interface AvatarUser {
  displayName?: string | null;
  initials?: string | null;
  color?: string | null;
}

export function UserAvatar({ user, size = 24, className, ring = false }: { user: AvatarUser; size?: number; className?: string; ring?: boolean }) {
  const color = user.color ?? "#64748b";
  return (
    <span
      title={user.displayName ?? undefined}
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold tracking-tight",
        ring && "ring-2 ring-background",
        className,
      )}
      style={{
        width: size,
        height: size,
        fontSize: Math.max(9, Math.round(size * 0.4)),
        color,
        background: `color-mix(in oklch, ${color} 18%, transparent)`,
        boxShadow: `inset 0 0 0 1px color-mix(in oklch, ${color} 35%, transparent)`,
      }}
    >
      {user.initials ?? "?"}
    </span>
  );
}

export function UserChip({ user, className }: { user: AvatarUser; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-sm", className)}>
      <UserAvatar user={user} size={20} />
      <span className="truncate">{user.displayName}</span>
    </span>
  );
}
