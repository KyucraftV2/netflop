"use server";

import { signIn } from "@/auth";

export async function loginWithAuthentik(): Promise<void> {
  await signIn("authentik", { redirectTo: "/" });
}
