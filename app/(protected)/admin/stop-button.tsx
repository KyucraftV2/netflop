"use client";

import { useTransition } from "react";
import { adminStopBrowser } from "@/app/actions/admin";
import { Button } from "@/components/ui/button";

export function StopBrowserButton({ slug }: { slug: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant="danger"
      disabled={pending}
      onClick={() => start(async () => void (await adminStopBrowser({ slug })))}
      aria-label={`Arrêter le navigateur de ${slug}`}
    >
      {pending ? "Arrêt…" : "Arrêter"}
    </Button>
  );
}
