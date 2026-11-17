import { SLUG_REGEX } from "./browser-spec";

const MAX = 32;

/**
 * Dérive un slug de preferred_username : minuscules, accents retirés, caractères
 * invalides → « - ». Le résultat respecte toujours ^[a-z0-9_-]{1,32}$.
 */
export function slugify(input: string | null | undefined): string {
  const base = (input ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX)
    .replace(/-+$/, "");
  return base.length > 0 ? base : "user";
}

/** Variante n (n ≥ 2) d'un slug, tronquée pour rester ≤ 32 caractères : « alice-2 ». */
export function slugWithSuffix(base: string, n: number): string {
  const suffix = `-${n}`;
  return `${base.slice(0, MAX - suffix.length).replace(/-+$/, "")}${suffix}`;
}

/** Premier slug libre parmi base, base-2, base-3… */
export async function uniqueSlug(
  base: string,
  isTaken: (candidate: string) => Promise<boolean>,
): Promise<string> {
  const root = slugify(base);
  if (!(await isTaken(root))) return root;
  for (let n = 2; n < 10_000; n++) {
    const candidate = slugWithSuffix(root, n);
    if (!(await isTaken(candidate))) return candidate;
  }
  throw new Error("Impossible de trouver un slug libre");
}

export function isValidSlug(s: string): boolean {
  return SLUG_REGEX.test(s);
}
