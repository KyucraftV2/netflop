import { Skeleton } from "@/components/ui/skeleton";

export function HomeSkeleton() {
  return (
    <div className="mx-auto max-w-[1600px] px-4 pt-24 md:px-8">
      <Skeleton className="h-8 w-48" />
      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-5">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="aspect-video" />
        ))}
      </div>
    </div>
  );
}
