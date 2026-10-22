import { Suspense } from "react";
import { AppSidebar } from "@/components/mos/app-sidebar";
import { CommandPalette } from "@/components/mos/command-palette";
import { LiveRefresh } from "@/components/mos/live-refresh";
import { UserMenu } from "@/components/mos/user-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { getCurrentUser } from "@/lib/auth";
import { PERSONAS } from "@/lib/personas";

async function SidebarUser() {
  const user = await getCurrentUser();
  return <UserMenu user={user} personas={process.env.DEMO_MODE === "true" ? PERSONAS : []} />;
}

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex h-dvh overflow-hidden">
      {/* usePathname() is request data on dynamic routes, so the sidebar streams in behind its own boundary. */}
      <Suspense fallback={<aside className="h-dvh w-[236px] shrink-0 border-r bg-sidebar" />}>
        <AppSidebar
          userSlot={
            <Suspense fallback={<Skeleton className="h-10 w-full rounded-lg" />}>
              <SidebarUser />
            </Suspense>
          }
        />
      </Suspense>
      <main className="relative min-w-0 flex-1 overflow-y-auto">{children}</main>
      <CommandPalette />
      <Suspense>
        <LiveRefresh />
      </Suspense>
    </div>
  );
}
