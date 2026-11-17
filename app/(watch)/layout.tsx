import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { requirePageUser } from "@/lib/auth-guard";

/** Lecture plein écran : pas d'en-tête, fond noir. */
export default async function WatchLayout({ children }: { children: ReactNode }) {
  const user = await requirePageUser();
  if (!user.onboarded) redirect("/bienvenue");
  return <div className="fixed inset-0 bg-black">{children}</div>;
}
