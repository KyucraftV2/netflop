"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { LogOut, Shield, User as UserIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { logout } from "@/app/actions/profile";
import { cn } from "@/lib/utils";
import { Logo } from "./logo";

export interface HeaderUser {
  displayName: string;
  image: string | null;
  role: "user" | "admin";
}

const NAV = [
  { href: "/", label: "Accueil" },
  { href: "/historique", label: "Historique" },
];

export function Header({ user, search }: { user: HeaderUser; search?: ReactNode }) {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "safe-top safe-x fixed inset-x-0 top-0 z-40 transition-colors duration-300",
        scrolled
          ? "bg-bg/95 shadow-card backdrop-blur"
          : "bg-gradient-to-b from-black/80 to-transparent",
      )}
    >
      <div className="mx-auto flex h-16 max-w-[1600px] items-center gap-3 px-4 md:gap-6 md:px-8">
        <Logo className="text-2xl md:text-3xl" />
        <nav aria-label="Navigation principale" className="hidden sm:block">
          <ul className="flex items-center gap-1">
            {NAV.map((item) => {
              const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "inline-flex min-h-11 items-center rounded-card px-3 text-sm transition-colors",
                      active ? "font-semibold text-white" : "text-muted hover:text-white",
                    )}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          {search}
          <UserMenu user={user} />
        </div>
      </div>
    </header>
  );
}

function Avatar({ user }: { user: HeaderUser }) {
  const initial = user.displayName.trim().charAt(0).toUpperCase() || "?";
  if (user.image) {
    // eslint-disable-next-line @next/next/no-img-element -- avatar Authentik, domaine variable
    return <img src={user.image} alt="" className="size-9 rounded-card object-cover" />;
  }
  return (
    <span className="flex size-9 items-center justify-center rounded-card bg-accent text-sm font-bold text-white">
      {initial}
    </span>
  );
}

function UserMenu({ user }: { user: HeaderUser }) {
  const itemClass =
    "flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-card px-3 text-sm outline-none data-[highlighted]:bg-white/10";
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        className="flex min-h-11 min-w-11 items-center justify-center rounded-card"
        aria-label={`Menu de ${user.displayName}`}
      >
        <Avatar user={user} />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          className="z-50 min-w-56 rounded-tile border border-white/10 bg-surface p-2 shadow-pop"
        >
          <div className="px-3 py-2 text-sm font-semibold">{user.displayName}</div>
          <DropdownMenu.Separator className="my-1 h-px bg-white/10" />
          <DropdownMenu.Item asChild>
            <Link href="/historique" className={cn(itemClass, "sm:hidden")}>
              Historique
            </Link>
          </DropdownMenu.Item>
          <DropdownMenu.Item asChild>
            <Link href="/profil" className={itemClass}>
              <UserIcon className="size-4" aria-hidden /> Profil
            </Link>
          </DropdownMenu.Item>
          {user.role === "admin" ? (
            <DropdownMenu.Item asChild>
              <Link href="/admin" className={itemClass}>
                <Shield className="size-4" aria-hidden /> Admin
              </Link>
            </DropdownMenu.Item>
          ) : null}
          <DropdownMenu.Separator className="my-1 h-px bg-white/10" />
          <form action={logout}>
            <DropdownMenu.Item asChild>
              <button type="submit" className={itemClass}>
                <LogOut className="size-4" aria-hidden /> Se déconnecter
              </button>
            </DropdownMenu.Item>
          </form>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
