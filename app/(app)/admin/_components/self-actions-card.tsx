"use client";

import { useOptimistic, useTransition } from "react";
import { toast } from "sonner";
import { Scale } from "lucide-react";
import { setAllowSelfActions } from "@/app/actions/collab";
import { Switch } from "@/components/ui/switch";

export function SelfActionsCard({ allow }: { allow: boolean }) {
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useOptimistic(allow, (_: boolean, next: boolean) => next);

  const change = (next: boolean) =>
    startTransition(async () => {
      setValue(next);
      const res = await setAllowSelfActions(next);
      if (res.ok) toast.success(next ? "Solo demo mode is on. People can act on their own snapshots." : "Separation of duties is enforced again.");
      else toast.error(res.error);
    });

  return (
    <section aria-labelledby="self-actions" className="rounded-xl border bg-card p-4">
      <div className="flex items-start justify-between gap-6">
        <div className="space-y-1.5">
          <h2 id="self-actions" className="flex items-center gap-2 text-sm font-semibold">
            <Scale className="size-4 text-muted-foreground" /> Allow self-actions
            <span className="rounded-full border px-1.5 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">solo demo mode</span>
          </h2>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Normally nobody can review, test or approve a snapshot they wrote, and nobody can approve one they reviewed. That separation of duties is what makes an approval mean something. Turn this on only when
            a single person is walking through the whole lifecycle alone, for example in a demo.
          </p>
          <p className="text-xs text-muted-foreground">{value ? "Currently off the hook: every action is allowed on your own work." : "Currently enforced: the database rejects self-review and self-approval."}</p>
        </div>
        <Switch checked={value} disabled={pending} onCheckedChange={change} aria-label="Allow self-actions" />
      </div>
    </section>
  );
}
