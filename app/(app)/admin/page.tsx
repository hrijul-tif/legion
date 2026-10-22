import type { Metadata } from "next";
import { Suspense } from "react";
import { Lock, ServerCog } from "lucide-react";
import { EmptyState, PageBody, PageHeader } from "@/components/mos/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { getCurrentUser } from "@/lib/auth";
import { fetchProfiles } from "@/lib/data/audit";
import { createClient } from "@/lib/supabase/server";
import { RoleEditor } from "./_components/role-editor";
import { SelfActionsCard } from "./_components/self-actions-card";

export const metadata: Metadata = { title: "Admin" };

export default function AdminPage() {
  return (
    <>
      <PageHeader title="Users & roles" description="Who can write, review, test and approve. Role changes take effect immediately." />
      <PageBody>
        <Suspense fallback={<AdminSkeleton />}>
          <AdminContent />
        </Suspense>
      </PageBody>
    </>
  );
}

async function AdminContent() {
  const user = await getCurrentUser();
  if (!user.roles.includes("admin")) {
    return (
      <EmptyState icon={<Lock />} title="Admins only" className="mx-auto max-w-lg">
        Managing people and settings needs the admin role, and yours is {user.roles.join(", ") || "empty"}. Ask an admin if you need a role changed.
      </EmptyState>
    );
  }

  const supabase = await createClient();
  const [profiles, settings] = await Promise.all([fetchProfiles(supabase), supabase.from("app_settings").select("allow_self_actions").maybeSingle()]);
  const users = [...profiles.values()].map((p) => ({ id: p.id, email: p.email, displayName: p.display_name, initials: p.initials, color: p.color, title: p.title, roles: p.roles }));
  const allow = !!(settings.data as { allow_self_actions?: boolean } | null)?.allow_self_actions;

  return (
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-6">
        <RoleEditor users={users} selfId={user.id} />
        <SelfActionsCard allow={allow} />
      </div>
      <EnvironmentCard />
    </div>
  );
}

/** Which integrations are configured. Reports presence only, never values. */
function EnvironmentCard() {
  const env = process.env;
  const rows: { label: string; detail: string; on: boolean }[] = [
    { label: "Demo mode", detail: env.DEMO_MODE === "true" ? "Persona sign-in is offered" : "Off", on: env.DEMO_MODE === "true" },
    { label: "Supabase URL", detail: env.NEXT_PUBLIC_SUPABASE_URL ? "Configured" : "Missing", on: !!env.NEXT_PUBLIC_SUPABASE_URL },
    { label: "Supabase publishable key", detail: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ? "Configured" : "Missing", on: !!env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY },
    { label: "Supabase secret key", detail: env.SUPABASE_SECRET_KEY ? "Configured (server only)" : "Not set", on: !!env.SUPABASE_SECRET_KEY },
    { label: "Bifrost runner", detail: env.BIFROST_ENABLED === "true" ? "Enabled" : "Disabled. Dry runs use the in-browser simulator", on: env.BIFROST_ENABLED === "true" },
    { label: "Bifrost base URL", detail: env.BIFROST_BASE_URL ? "Configured" : "Not set", on: !!env.BIFROST_BASE_URL },
  ];
  return (
    <section aria-labelledby="env-card" className="rounded-xl border bg-card">
      <header className="flex items-center gap-2 border-b px-4 py-3">
        <ServerCog className="size-4 text-muted-foreground" />
        <h2 id="env-card" className="text-sm font-semibold">
          Environment
        </h2>
        <span className="ml-auto text-[11px] text-muted-foreground">read-only</span>
      </header>
      <ul className="divide-y">
        {rows.map((r) => (
          <li key={r.label} className="flex items-start gap-3 px-4 py-2.5 text-sm">
            <span className={`mt-1.5 size-2 shrink-0 rounded-full ${r.on ? "bg-tone-success" : "bg-tone-muted/60"}`} aria-hidden />
            <div className="min-w-0">
              <p className="font-medium">{r.label}</p>
              <p className="text-xs text-muted-foreground">
                <span className="sr-only">{r.on ? "On: " : "Off: "}</span>
                {r.detail}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function AdminSkeleton() {
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-6">
        <Skeleton className="h-96 rounded-xl" />
        <Skeleton className="h-32 rounded-xl" />
      </div>
      <Skeleton className="h-72 rounded-xl" />
    </div>
  );
}
