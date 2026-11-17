/**
 * Logs structurés (une ligne JSON par événement), lisibles avec `docker compose logs`.
 * Ne jamais y passer de cookie, jeton, mot de passe ou en-tête d'authentification.
 */
type Level = "debug" | "info" | "warn" | "error";
type Fields = Record<string, string | number | boolean | null | undefined>;

function write(level: Level, scope: string, msg: string, fields?: Fields): void {
  const line = JSON.stringify({ t: new Date().toISOString(), level, scope, msg, ...fields });
  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);
}

export function logger(scope: string) {
  return {
    debug: (msg: string, fields?: Fields) => {
      if (process.env.LOG_LEVEL === "debug") write("debug", scope, msg, fields);
    },
    info: (msg: string, fields?: Fields) => write("info", scope, msg, fields),
    warn: (msg: string, fields?: Fields) => write("warn", scope, msg, fields),
    error: (msg: string, fields?: Fields) => write("error", scope, msg, fields),
  };
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
