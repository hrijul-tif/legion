import { cn } from "@/lib/utils";

export function MosLogo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <svg viewBox="0 0 32 32" className="size-7" aria-hidden>
        <defs>
          <linearGradient id="mos-g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="var(--primary)" />
            <stop offset="1" stopColor="var(--tone-success)" />
          </linearGradient>
        </defs>
        <rect x="1" y="1" width="30" height="30" rx="8" fill="url(#mos-g)" opacity="0.16" />
        <circle cx="16" cy="16" r="9.5" fill="none" stroke="url(#mos-g)" strokeWidth="1.6" strokeDasharray="3 2.4" />
        <ellipse cx="16" cy="16" rx="12.5" ry="4.2" fill="none" stroke="url(#mos-g)" strokeWidth="1.6" transform="rotate(-28 16 16)" />
        <circle cx="16" cy="16" r="3" fill="url(#mos-g)" />
      </svg>
      <span className="leading-none">
        <span className="block text-[15px] font-semibold tracking-tight">MOS</span>
        <span className="block text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Mission Ops</span>
      </span>
    </span>
  );
}
