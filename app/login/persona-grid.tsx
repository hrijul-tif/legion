"use client";

import { useFormStatus } from "react-dom";
import { motion } from "motion/react";
import { Loader2 } from "lucide-react";
import type { Persona } from "@/lib/personas";
import { UserAvatar } from "@/components/mos/user-avatar";
import { signInAsPersona } from "./actions";

function PersonaButton({ persona }: { persona: Persona }) {
  const { pending, data } = useFormStatus();
  const me = pending && data?.get("email") === persona.email;
  return (
    <button
      type="submit"
      name="email"
      value={persona.email}
      disabled={pending}
      className="group relative flex w-full items-start gap-3 rounded-xl border bg-card/60 p-3 text-left transition hover:-translate-y-0.5 hover:border-primary/40 hover:bg-card hover:shadow-lg hover:shadow-primary/5 disabled:opacity-60"
    >
      <UserAvatar user={persona} size={36} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 font-medium">
          {persona.displayName}
          {me && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
        </span>
        <span className="block text-xs text-muted-foreground">{persona.title}</span>
        <span className="mt-2 flex flex-wrap gap-1">
          {persona.roles.map((r) => (
            <span key={r} className="rounded-md border bg-muted/60 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {r}
            </span>
          ))}
        </span>
      </span>
    </button>
  );
}

export function PersonaGrid({ personas, next }: { personas: Persona[]; next: string }) {
  return (
    <section className="rounded-2xl border bg-card/40 p-5 backdrop-blur">
      <div className="mb-4">
        <h2 className="font-semibold">Sign in as a demo persona</h2>
        <p className="text-sm text-muted-foreground">Each one sees MOS through their roles. Switch any time from the sidebar.</p>
      </div>
      <form action={signInAsPersona} className="grid gap-2.5 sm:grid-cols-2">
        <input type="hidden" name="next" value={next} />
        {personas.map((p, i) => (
          <motion.div key={p.email} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.04 * i }}>
            <PersonaButton persona={p} />
          </motion.div>
        ))}
      </form>
    </section>
  );
}
