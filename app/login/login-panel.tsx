import { PERSONAS } from "@/lib/personas";
import { PersonaGrid } from "./persona-grid";
import { PasswordForm } from "./password-form";

export async function LoginPanel({ searchParams, demoMode }: { searchParams: Promise<Record<string, string | string[] | undefined>>; demoMode: boolean }) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : "/";
  const error = typeof params.error === "string" ? params.error : undefined;
  return (
    <div className="grid gap-6 md:grid-cols-[1.4fr_1fr]">
      {demoMode && <PersonaGrid personas={PERSONAS} next={next} />}
      <PasswordForm next={next} initialError={error} className={demoMode ? "" : "md:col-span-2 mx-auto w-full max-w-sm"} />
    </div>
  );
}
