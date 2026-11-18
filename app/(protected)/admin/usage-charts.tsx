import type { DayUsage, UsageShare } from "@/lib/admin";

export function formatHours(h: number): string {
  if (h <= 0) return "0 h";
  if (h < 1) return `${Math.round(h * 60)} min`;
  return `${h.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} h`;
}

const dayLabel = (day: string, opts: Intl.DateTimeFormatOptions) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString("fr-FR", { timeZone: "UTC", ...opts });

/**
 * Colonnes : heures de visionnage par jour. Une seule série (pas de légende), valeur au
 * survol et au focus, tableau équivalent pour les lecteurs d'écran.
 */
export function DailyUsageChart({ data }: { data: DayUsage[] }) {
  const max = Math.max(...data.map((d) => d.hours), 0);
  const total = data.reduce((s, d) => s + d.hours, 0);
  const top = max > 0 ? niceCeil(max) : 1;
  return (
    <figure className="mt-4 rounded-tile bg-surface p-4">
      <figcaption className="text-sm text-muted">
        {formatHours(total)} au total sur {data.length} jours
      </figcaption>
      <div className="mt-4 flex gap-2" aria-hidden>
        <div className="flex h-40 flex-col justify-between text-right text-[11px] text-muted">
          <span>{formatHours(top)}</span>
          <span>{formatHours(top / 2)}</span>
          <span>0</span>
        </div>
        <div className="relative h-40 flex-1">
          {[0, 0.5, 1].map((f) => (
            <div
              key={f}
              className="absolute inset-x-0 border-t border-white/10"
              style={{ bottom: `${f * 100}%` }}
            />
          ))}
          <div className="absolute inset-0 flex items-end gap-[2px]">
            {data.map((d) => (
              <div
                key={d.day}
                className="group relative flex h-full flex-1 items-end"
                title={`${dayLabel(d.day, { weekday: "long", day: "numeric", month: "long" })} : ${formatHours(d.hours)}`}
              >
                <div
                  className="w-full rounded-t-[4px] bg-accent transition-opacity group-hover:opacity-80"
                  style={{ height: d.hours > 0 ? `max(2px, ${(d.hours / top) * 100}%)` : 0 }}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-1 flex gap-2 text-[11px] text-muted" aria-hidden>
        <div className="w-9 shrink-0" />
        <div className="flex flex-1 justify-between">
          <span>{dayLabel(data[0]!.day, { day: "numeric", month: "short" })}</span>
          <span>{dayLabel(data.at(-1)!.day, { day: "numeric", month: "short" })}</span>
        </div>
      </div>
      <table className="sr-only">
        <caption>Heures de visionnage par jour</caption>
        <thead>
          <tr>
            <th>Jour</th>
            <th>Durée</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.day}>
              <td>{dayLabel(d.day, { weekday: "long", day: "numeric", month: "long" })}</td>
              <td>{formatHours(d.hours)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/** Barres horizontales dans un tableau (par plateforme, par utilisateur). */
export function ShareTable({
  caption,
  rows,
  renderLabel,
}: {
  caption: string;
  rows: UsageShare[];
  renderLabel?: (r: UsageShare) => React.ReactNode;
}) {
  const max = Math.max(...rows.map((r) => r.hours), 0);
  if (rows.length === 0) return <p className="mt-4 text-sm text-muted">Aucune lecture.</p>;
  return (
    <table className="mt-4 w-full text-sm">
      <caption className="sr-only">{caption}</caption>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key} className="border-t border-white/5 first:border-0">
            <th scope="row" className="w-36 py-2 pr-3 text-left font-normal">
              {renderLabel ? renderLabel(r) : r.label}
            </th>
            <td className="py-2" aria-hidden>
              <div
                className="h-2 rounded-r-[4px] bg-white/70"
                style={{ width: `${max ? (r.hours / max) * 100 : 0}%` }}
              />
            </td>
            <td className="w-20 py-2 pl-3 text-right tabular-nums">{formatHours(r.hours)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function niceCeil(v: number): number {
  const steps = [0.5, 1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 24, 30, 40, 50, 75, 100];
  return steps.find((s) => s >= v) ?? Math.ceil(v / 50) * 50;
}
