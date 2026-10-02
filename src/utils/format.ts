/** Affichage français des dates, heures et durées. */

const dayFormatter = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const dayWithYearFormatter = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});
const shortDayFormatter = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const timeFormatter = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });

const toUtcDate = (localDate: string): Date => {
  const [y, m, d] = localDate.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d));
};

/** « mardi 8 septembre » (année ajoutée si ce n'est pas l'année en cours). */
export function formatDayLong(localDate: string, currentYear: number = new Date().getFullYear()): string {
  const date = toUtcDate(localDate);
  return (date.getUTCFullYear() === currentYear ? dayFormatter : dayWithYearFormatter).format(date);
}

/** « 8 sept. » */
export const formatDayShort = (localDate: string): string => shortDayFormatter.format(toUtcDate(localDate));

/** Heure locale « 18:02 » d'un horodatage ISO. */
export const formatTime = (isoDateTime: string): string => timeFormatter.format(new Date(isoDateTime));

/** Durée lisible : « 45 min », « 1 h 08 », « < 1 min ». */
export function formatDuration(seconds: number): string {
  const totalMinutes = Math.round(seconds / 60);
  if (totalMinutes < 1) return '< 1 min';
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  return `${hours} h ${String(totalMinutes % 60).padStart(2, '0')}`;
}
