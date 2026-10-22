"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { signInWithPassword } from "./actions";

export function PasswordForm({ next, initialError, className }: { next: string; initialError?: string; className?: string }) {
  const [state, action, pending] = useActionState(signInWithPassword, { error: initialError });
  return (
    <section className={cn("rounded-2xl border bg-card/40 p-5 backdrop-blur", className)}>
      <h2 className="font-semibold">Sign in with email</h2>
      <p className="mb-4 text-sm text-muted-foreground">Your MOS account.</p>
      <form action={action} className="grid gap-3">
        <input type="hidden" name="next" value={next} />
        <div className="grid gap-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" autoComplete="username" required />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="password">Password</Label>
          <Input id="password" name="password" type="password" autoComplete="current-password" required />
        </div>
        {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
        <Button type="submit" disabled={pending} className="mt-1">
          {pending && <Loader2 className="animate-spin" />} Sign in
        </Button>
      </form>
    </section>
  );
}
