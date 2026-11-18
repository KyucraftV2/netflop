"use client";

import { useState, useTransition } from "react";
import { completeOnboarding } from "@/app/actions/profile";
import { PlatformPicker } from "@/components/platform-picker";
import { Button } from "@/components/ui/button";
import type { PlatformId } from "@/lib/platforms";

export function OnboardingForm({ available }: { available: PlatformId[] }) {
  const [platforms, setPlatforms] = useState<PlatformId[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="mt-8"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        startTransition(async () => {
          const r = await completeOnboarding({ platforms });
          if (r && !r.ok) setError(r.error);
        });
      }}
    >
      <PlatformPicker
        platforms={available}
        value={platforms}
        onChange={setPlatforms}
        disabled={pending}
      />
      {error ? (
        <p role="alert" className="mt-4 text-sm text-danger">
          {error}
        </p>
      ) : null}
      <Button type="submit" size="lg" className="mt-6 w-full sm:w-auto" disabled={pending}>
        {pending ? "Enregistrement…" : "C'est parti"}
      </Button>
      {platforms.length === 0 ? (
        <p className="mt-2 text-xs text-muted">
          Aucune sélection : tu pourras choisir plus tard dans ton profil.
        </p>
      ) : null}
    </form>
  );
}
