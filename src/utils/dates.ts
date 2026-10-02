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

/** Nombre de secondes entières entre deux horodatages ISO (jamais négatif). */
export function secondsBetween(startIso: string, endIso: string): number {
  const diff = Math.round((Date.parse(endIso) - Date.parse(startIso)) / 1000);
  return Number.isFinite(diff) && diff > 0 ? diff : 0;
}
