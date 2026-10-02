const pad = (n: number, width = 2): string => String(Math.trunc(Math.abs(n))).padStart(width, '0');

/**
 * Horodatage ISO 8601 avec l'offset local (ex. 2026-10-01T18:45:00+02:00).
 * `Date.toISOString()` produit du UTC (`Z`), d'où cet utilitaire (SPEC §5.1).
 */
export function toLocalIsoString(date: Date): string {
  const offsetMin = -date.getTimezoneOffset();
  const sign = offsetMin >= 0 ? '+' : '-';
  return (
    `${toLocalDateString(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(offsetMin / 60)}:${pad(offsetMin % 60)}`
  );
}

/** Date métier locale `YYYY-MM-DD`. */
export function toLocalDateString(date: Date): string {
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const ISO_WALL_CLOCK = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/;

/** Nombre de jours calendaires de `fromDate` à `toDate` (`YYYY-MM-DD`). */
export function daysBetween(fromDate: string, toDate: string): number {
  const utc = (d: string) => {
    const [y, m, day] = d.split('-').map(Number) as [number, number, number];
    return Date.UTC(y, m - 1, day);
  };
  return Math.round((utc(toDate) - utc(fromDate)) / 86_400_000);
}

/**
 * Décale un horodatage ISO de `days` jours calendaires en conservant l'heure murale
 * telle qu'écrite (ex. 18:10), avec l'offset local du nouveau jour (heure d'été/hiver).
 */
export function shiftIsoByDays(iso: string, days: number): string {
  const match = ISO_WALL_CLOCK.exec(iso);
  if (!match) throw new Error(`Horodatage ISO invalide : ${iso}`);
  const [y, mo, d, h, mi, s] = match.slice(1).map(Number) as [number, number, number, number, number, number];
  return toLocalIsoString(new Date(y, mo - 1, d + days, h, mi, s));
}

/** Nombre de secondes entières entre deux horodatages ISO (jamais négatif). */
export function secondsBetween(startIso: string, endIso: string): number {
  const diff = Math.round((Date.parse(endIso) - Date.parse(startIso)) / 1000);
  return Number.isFinite(diff) && diff > 0 ? diff : 0;
}
