import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { WatchClient } from "@/components/watch/watch-client";
import { requirePageUser } from "@/lib/auth-guard";
import { isPlatformEnabled, isPlatformId, PLATFORMS } from "@/lib/platforms";

type Params = { platform: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { platform } = await params;
  return { title: isPlatformId(platform) ? PLATFORMS[platform].name : "Lecture" };
}

export default async function WatchPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<{ opened?: string }>;
}) {
  const user = await requirePageUser();
  const { platform } = await params;
  if (!isPlatformId(platform) || !isPlatformEnabled(platform)) notFound();
  const { opened } = await searchParams;
  return (
    <WatchClient
      platform={platform}
      slug={user.slug}
      // ?opened=1 : /api/browser/open a déjà démarré ou piloté le navigateur.
      alreadyRequested={opened === "1"}
    />
  );
}
