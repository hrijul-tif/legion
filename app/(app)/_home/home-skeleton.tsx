import { Skeleton } from "@/components/ui/skeleton";

export function HomeSkeleton() {
  return (
    <>
      <div className="space-y-2 border-b px-6 pt-6 pb-5 lg:px-8">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="grid gap-6 px-6 py-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:px-8">
        <div className="space-y-5">
          {[0, 1].map((i) => (
            <div key={i} className="overflow-hidden rounded-xl border">
              <div className="flex items-center gap-2 border-b px-4 py-3">
                <Skeleton className="size-2 rounded-full" />
                <Skeleton className="h-4 w-44" />
              </div>
              {[0, 1, 2].map((j) => (
                <div key={j} className="flex items-center gap-4 border-b px-4 py-3.5 last:border-0">
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-64 max-w-full" />
                    <Skeleton className="h-3 w-48" />
                  </div>
                  <Skeleton className="h-7 w-20" />
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="space-y-5">
          <Skeleton className="h-64 rounded-xl" />
          <Skeleton className="h-80 rounded-xl" />
        </div>
      </div>
    </>
  );
}
