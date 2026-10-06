/**
 * Calendrier d'activité de l'accueil (V1.4.0), style GitHub mais BINAIRE : un jour est « rempli »
 * s'il a au moins une séance TERMINÉE. Pas d'intensité, pas de score, pas de série de jours.
 * Tout est dérivé des séances (aucun stockage). Les dates sont des dates métier locales
 * `YYYY-MM-DD` (champ `date` des séances) : l'arithmétique se fait sur ces chaînes, sans fuseau,
 * donc sans effet des changements d'heure.
 */
import { addDaysToLocalDate } from '../utils/dates';
import type { WorkoutSession } from './types';

export const ACTIVITY_WEEKS = 12;

export interface ActivityDay {
  /** Date locale `YYYY-MM-DD`. */
  date: string;
  /** Au moins une séance terminée ce jour-là. */
  filled: boolean;
  /** Nombre de séances terminées ce jour-là (étiquette accessible, détail). */
  sessionCount: number;
  isToday: boolean;
  /** Jour à venir de la semaine en cours (ni rempli ni « raté »). */
  isFuture: boolean;
}

export interface ActivityCalendar {
  /** Colonnes = semaines (lundi → dimanche), de la plus ancienne à la semaine en cours. */
  weeks: ActivityDay[][];
  /** Séances terminées dans la période affichée (jusqu'à aujourd'hui). */
  sessionCount: number;
  firstDate: string;
  today: string;
}

/** Jour de la semaine d'une date locale, lundi = 0 … dimanche = 6. */
export function mondayIndex(localDate: string): number {
  const [y, m, d] = localDate.split('-').map(Number) as [number, number, number];
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

/** Séances terminées d'un jour (ordre chronologique). */
export function completedSessionsOn(sessions: readonly WorkoutSession[], date: string): WorkoutSession[] {
  return sessions
    .filter((s) => s.status === 'completed' && s.date === date)
    .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
}

/**
 * Grille de `weeks` semaines (lundi en premier) dont la dernière colonne est la semaine de `today`.
 * Seules les séances `completed` comptent ; plusieurs séances le même jour = une seule case.
 */
export function buildActivityCalendar(sessions: readonly WorkoutSession[], today: string, weeks: number = ACTIVITY_WEEKS): ActivityCalendar {
  const firstDate = addDaysToLocalDate(today, -mondayIndex(today) - 7 * (weeks - 1));
  const counts = new Map<string, number>();
  for (const s of sessions) {
    if (s.status === 'completed') counts.set(s.date, (counts.get(s.date) ?? 0) + 1);
  }
  let sessionCount = 0;
  const columns: ActivityDay[][] = [];
  for (let w = 0; w < weeks; w++) {
    const column: ActivityDay[] = [];
    for (let d = 0; d < 7; d++) {
      const date = addDaysToLocalDate(firstDate, w * 7 + d);
      const isFuture = date > today;
      const count = isFuture ? 0 : (counts.get(date) ?? 0);
      sessionCount += count;
      column.push({ date, filled: count > 0, sessionCount: count, isToday: date === today, isFuture });
    }
    columns.push(column);
  }
  return { weeks: columns, sessionCount, firstDate, today };
}

/**
 * Étiquettes de mois au-dessus de la grille : sur la colonne qui contient le 1er du mois, et sur
 * la première colonne. Une étiquette trop proche de la précédente (moins de 3 colonnes) est omise.
 */
export function monthLabels(calendar: ActivityCalendar): { column: number; month: number }[] {
  const labels: { column: number; month: number }[] = [];
  calendar.weeks.forEach((week, column) => {
    const first = column === 0 ? week[0] : week.find((day) => day.date.endsWith('-01'));
    if (!first) return;
    const month = Number(first.date.slice(5, 7));
    const previous = labels.at(-1);
    if (previous && column - previous.column < 3) {
      // Le 1er du mois l'emporte sur l'étiquette de la première colonne (mois à peine entamé).
      if (previous.column === 0 && column > 0) labels[labels.length - 1] = { column, month };
      return;
    }
    labels.push({ column, month });
  });
  return labels;
}
