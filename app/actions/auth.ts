"use server";

import { signIn } from "@/auth";
import { safeNextPath } from "@/lib/utils";

export async function loginWithAuthentik(formData?: FormData): Promise<void> {
  const next = safeNextPath(formData?.get("next"));
  await signIn("authentik", { redirectTo: next });
}
