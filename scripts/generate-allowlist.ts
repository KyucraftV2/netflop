/**
 * Génère browser/policies-allowlist.json depuis lib/platforms.ts.
 *   bun run allowlist          # écrit le fichier
 *   bun run allowlist --check  # échoue si le fichier n'est pas à jour
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { allowlistJson } from "../lib/allowlist";

const target = fileURLToPath(new URL("../browser/policies-allowlist.json", import.meta.url));
const wanted = allowlistJson();

if (process.argv.includes("--check")) {
  const current = readFileSync(target, "utf8");
  if (current !== wanted) {
    console.error("browser/policies-allowlist.json n'est pas à jour : lance `bun run allowlist`.");
    process.exit(1);
  }
  console.log("Liste blanche à jour.");
} else {
  writeFileSync(target, wanted);
  console.log(`Écrit : ${target}`);
}
