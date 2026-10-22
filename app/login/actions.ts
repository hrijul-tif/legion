"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PERSONAS } from "@/lib/personas";

function safeNext(next: FormDataEntryValue | null): string {
  const value = typeof next === "string" ? next : "/";
  return value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

export async function signInWithPassword(_: unknown, form: FormData): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: String(form.get("email") ?? ""),
    password: String(form.get("password") ?? ""),
  });
  if (error) return { error: error.message };
  redirect(safeNext(form.get("next")));
}

/** Demo-only: signs in as a seeded persona. The shared password never reaches the browser. */
export async function signInAsPersona(form: FormData): Promise<void> {
  if (process.env.DEMO_MODE !== "true") throw new Error("Demo sign-in is disabled");
  const email = String(form.get("email") ?? "");
  if (!PERSONAS.some((p) => p.email === email)) throw new Error("Unknown persona");
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password: process.env.DEMO_PASSWORD ?? "" });
  if (error) redirect(`/login?error=${encodeURIComponent(error.message)}`);
  redirect(safeNext(form.get("next")));
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
