import { redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { Attribution } from "@/components/attribution";
import { SearchBox } from "@/components/search-box";
import { Header } from "@/components/header";
import { requirePageUser } from "@/lib/auth-guard";

export default async function ProtectedLayout({ children }: { children: ReactNode }) {
  const user = await requirePageUser();
  if (!user.onboarded) redirect("/bienvenue");
  return (
    <>
      <a
        href="#contenu"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-card focus:bg-white focus:px-4 focus:py-2 focus:text-black"
      >
        Aller au contenu
      </a>
      <Header
        user={{ displayName: user.displayName, image: user.image ?? null, role: user.role }}
        search={
          <Suspense fallback={<div className="size-11" />}>
            <SearchBox />
          </Suspense>
        }
      />
      <div id="contenu" className="safe-x pb-16">
        {children}
      </div>
      <Attribution />
    </>
  );
}
