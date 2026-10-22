import type { Metadata } from "next";
import { Suspense } from "react";
import { Inbox } from "lucide-react";
import { EmptyState, PageBody, PageHeader } from "@/components/mos/page-header";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getHomeData } from "@/lib/data/queue";
import { ROLES } from "@/lib/lifecycle";
import { Greeting } from "./_home/greeting";
import { HomeSkeleton } from "./_home/home-skeleton";
import { QueueSectionCard } from "./_home/queue-section";
import { ActivityFeed, ProdGlance } from "./_home/side-panels";

export const metadata: Metadata = { title: "My queue" };

export default function HomePage() {
  return (
    <Suspense fallback={<HomeSkeleton />}>
      <HomeContent />
    </Suspense>
  );
}

async function HomeContent() {
  const user = await getCurrentUser();
  const supabase = await createClient();
  const data = await getHomeData(supabase, user);
  const roles = ROLES.filter((r) => user.roles.includes(r));

  const summary =
    data.waiting === 0
      ? "You are all caught up. Nothing is waiting on you right now."
      : `${data.waiting} ${data.waiting === 1 ? "snapshot needs" : "snapshots need"} you${data.stale ? `, ${data.stale} ${data.stale === 1 ? "has" : "have"} been sitting too long` : ""}.`;

  return (
    <>
      <PageHeader
        eyebrow={
          <span className="inline-flex flex-wrap items-center gap-1.5">
            My queue
            {roles.map((r) => (
              <span key={r} className="rounded-full border bg-muted/50 px-1.5 py-px text-[11px] capitalize">
                {r}
              </span>
            ))}
          </span>
        }
        title={<Greeting name={user.displayName.split(" ")[0]} />}
        description={summary}
      />
      <PageBody className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-5">
          {data.sections.length ? (
            data.sections.map((s) => <QueueSectionCard key={s.id} section={s} />)
          ) : (
            <EmptyState icon={<Inbox />} title="No queue for your roles">
              You do not hold any role that works from a queue. Ask an admin to grant author, reviewer, tester or approver.
            </EmptyState>
          )}
        </div>
        <aside className="min-w-0 space-y-5 lg:sticky lg:top-6">
          <ProdGlance glance={data.glance} />
          <ActivityFeed items={data.activity} />
        </aside>
      </PageBody>
    </>
  );
}
