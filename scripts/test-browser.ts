import { getConfig } from "../lib/config";
import { assertSlug, internalIpForSlot } from "../lib/browser-spec";
import { createDockerClient } from "../lib/docker";
import { errorMessage } from "../lib/log";
import { nekoAdminPassword, nekoUserPassword } from "../lib/neko-secret";

/**
 * Crée / supprime un navigateur de test, sans passer par le hub.
 *   docker compose exec worker node test-browser.js <user> [--slot n]
 *   docker compose exec worker node test-browser.js <user> --rm
 *   docker compose exec worker node test-browser.js --list
 */

const USAGE = "Usage : node test-browser.js <user> [--slot n] | <user> --rm | --list";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const cfg = getConfig();
  const docker = createDockerClient({ config: cfg });

  if (args[0] === "--list") {
    console.table(await docker.listBrowsers());
    return;
  }

  const user = args[0];
  try {
    assertSlug(user);
  } catch {
    console.error(`Nom d'utilisateur invalide (attendu ^[a-z0-9_-]{1,32}$).\n${USAGE}`);
    process.exit(2);
  }

  if (args.includes("--rm")) {
    await docker.stopBrowser(user);
    await docker.removeBrowser(user);
    console.log(`neko-${user} supprimé (volume netflop-profile-${user} conservé).`);
    return;
  }

  const slotIdx = args.indexOf("--slot");
  const slot = slotIdx >= 0 ? Number(args[slotIdx + 1]) : 0;

  // Mot de passe Neko du test : affiché ci-dessous (navigateur de test uniquement).
  const testSession = `test-${user}`;
  const password = nekoAdminPassword(testSession);
  if (await docker.inspect(user)) {
    console.log(`neko-${user} existe déjà : démarrage.`);
  } else {
    await docker.createBrowser(user, slot, "normal", {
      adminPassword: password,
      userPassword: nekoUserPassword(testSession),
    });
  }
  await docker.startBrowser(user);

  const info = await docker.inspect(user);
  const ip = internalIpForSlot(info?.slot ?? slot, cfg);
  console.log(`
Navigateur neko-${user} démarré (slot ${info?.slot ?? slot}, port ${cfg.SLOT_PORTS[info?.slot ?? slot]}).

- Route Traefik : https://${cfg.HUB_DOMAIN}/b/${user}/
  → doit répondre 401 tant que l'authentification (étape 2) n'est pas en place.
- Test de lecture via tunnel SSH (depuis ta machine) :
    ssh -N -L 8080:${ip}:8080 <utilisateur>@<vps>
  puis ouvre http://localhost:8080/b/${user}/?usr=${user}&pwd=${password}
- Relais CDP (interne uniquement) : ${ip}:9223
- Supprimer : docker compose exec worker node test-browser.js ${user} --rm
`);
}

main().catch((err: unknown) => {
  console.error(`Échec : ${errorMessage(err)}`);
  process.exit(1);
});
