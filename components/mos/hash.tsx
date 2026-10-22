import { cn } from "@/lib/utils";
import { shortHash } from "@/lib/lifecycle";

export function SnapshotRef({ number, sha, className }: { number: number; sha?: string | null; className?: string }) {
  return (
    <span className={cn("inline-flex items-baseline gap-1.5 font-mono tabular", className)}>
      <span className="font-semibold text-foreground">#{number}</span>
      {sha && <span className="text-xs text-muted-foreground">{shortHash(sha)}</span>}
    </span>
  );
}
