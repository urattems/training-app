import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TEST_TIME_ZONE } from '../test/globalSetup';
import { buildActivityCalendar, completedSessionsOn, mondayIndex, monthLabels } from './activity';
import type { TrainingProgram, WorkoutSession, WorkoutStatus } from './types';
import { createWorkout } from './workout';

const program = JSON.parse(readFileSync(resolve(process.cwd(), 'examples', 'program-example.json'), 'utf8')) as TrainingProgram;

/** Séance réelle (date métier calculée par l'app à partir de l'heure locale de démarrage). */
function session(id: string, now: Date, status: WorkoutStatus = 'completed'): WorkoutSession {
  const w = createWorkout(program, 'A', { id, now });
  return status === 'in_progress' ? w : { ...w, status, completedAt: status === 'completed' ? w.startedAt : null, durationSec: status === 'completed' ? 3600 : null };
}

const allDays = (cal: ReturnType<typeof buildActivityCalendar>) => cal.weeks.flat();
const day = (cal: ReturnType<typeof buildActivityCalendar>, date: string) => allDays(cal).find((d) => d.date === date);

describe('buildActivityCalendar : disposition', () => {
  it('12 colonnes × 7 lignes exactement, lundi en premier, semaine en cours à droite', () => {
    const cal = buildActivityCalendar([], '2026-10-06'); // mardi
    expect(cal.weeks).toHaveLength(12);
    for (const week of cal.weeks) {
      expect(week).toHaveLength(7);
      expect(mondayIndex(week[0]?.date ?? '')).toBe(0);
      expect(mondayIndex(week[6]?.date ?? '')).toBe(6);
    }
    expect(cal.weeks[11]?.map((d) => d.date)).toEqual(['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11']);
    expect(cal.firstDate).toBe('2026-07-20');
    // 84 jours consécutifs, sans doublon.
    const dates = allDays(cal).map((d) => d.date);
    expect(new Set(dates).size).toBe(84);
  });

  it('aujourd’hui marqué ; jours à venir de la semaine marqués, jamais remplis', () => {
    const cal = buildActivityCalendar([], '2026-10-06');
    expect(allDays(cal).filter((d) => d.isToday).map((d) => d.date)).toEqual(['2026-10-06']);
    expect(allDays(cal).filter((d) => d.isFuture).map((d) => d.date)).toEqual(['2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11']);
    // Dimanche : aucun jour à venir ; lundi : six.
    expect(allDays(buildActivityCalendar([], '2026-10-11')).filter((d) => d.isFuture)).toHaveLength(0);
    expect(allDays(buildActivityCalendar([], '2026-10-05')).filter((d) => d.isFuture)).toHaveLength(6);
  });

  it('aucune séance : grille vide, compteur à 0', () => {
    const cal = buildActivityCalendar([], '2026-10-06');
    expect(allDays(cal).some((d) => d.filled)).toBe(false);
    expect(cal.sessionCount).toBe(0);
  });

  it('le jour change quand « aujourd’hui » change (injection)', () => {
    const sessions = [session('a', new Date(2026, 9, 5, 18, 0))];
    const monday = buildActivityCalendar(sessions, '2026-10-05');
    const nextMonday = buildActivityCalendar(sessions, '2026-10-12');
    expect(monday.weeks[11]?.[0]).toMatchObject({ date: '2026-10-05', filled: true, isToday: true });
    expect(nextMonday.weeks[10]?.[0]).toMatchObject({ date: '2026-10-05', filled: true, isToday: false });
    expect(nextMonday.weeks[11]?.[0]).toMatchObject({ date: '2026-10-12', filled: false, isToday: true });
  });
});

describe('buildActivityCalendar : quelles séances comptent', () => {
  it('seules les séances TERMINÉES remplissent ; abandonnée et en cours ignorées', () => {
    const sessions = [
      session('done', new Date(2026, 9, 1, 18, 0)),
      session('ab', new Date(2026, 9, 2, 18, 0), 'abandoned'),
      session('run', new Date(2026, 9, 6, 18, 0), 'in_progress'),
    ];
    const cal = buildActivityCalendar(sessions, '2026-10-06');
    expect(allDays(cal).filter((d) => d.filled).map((d) => d.date)).toEqual(['2026-10-01']);
    expect(cal.sessionCount).toBe(1);
  });

  it('deux séances le même jour = une seule case, compteur de séances à 2', () => {
    const sessions = [session('m', new Date(2026, 9, 1, 8, 0)), session('s', new Date(2026, 9, 1, 19, 0))];
    const cal = buildActivityCalendar(sessions, '2026-10-06');
    expect(allDays(cal).filter((d) => d.filled)).toHaveLength(1);
    expect(day(cal, '2026-10-01')?.sessionCount).toBe(2);
    expect(cal.sessionCount).toBe(2);
    expect(completedSessionsOn(sessions, '2026-10-01').map((s) => s.id)).toEqual(['m', 's']);
  });

  it(`séance à 23:59 et à 00:01 (${TEST_TIME_ZONE}) : chacune sur son jour local`, () => {
    const sessions = [session('late', new Date(2026, 8, 30, 23, 59)), session('early', new Date(2026, 9, 1, 0, 1))];
    expect(sessions.map((s) => s.date)).toEqual(['2026-09-30', '2026-10-01']);
    const cal = buildActivityCalendar(sessions, '2026-10-06');
    expect(day(cal, '2026-09-30')?.sessionCount).toBe(1);
    expect(day(cal, '2026-10-01')?.sessionCount).toBe(1);
  });

  it('séance plus ancienne que 12 semaines : absente (ni case ni compteur)', () => {
    const sessions = [session('old', new Date(2026, 6, 19, 18, 0)), session('edge', new Date(2026, 6, 20, 18, 0))];
    const cal = buildActivityCalendar(sessions, '2026-10-06');
    expect(day(cal, '2026-07-19')).toBeUndefined();
    expect(day(cal, '2026-07-20')?.filled).toBe(true);
    expect(cal.sessionCount).toBe(1);
  });
});

describe('Changements d’heure : aucun décalage, aucune case dupliquée', () => {
  it.each([
    ['heure d’été (dimanche 29 mars 2026)', '2026-03-31', [new Date(2026, 2, 28, 23, 59), new Date(2026, 2, 29, 0, 1), new Date(2026, 2, 29, 23, 59), new Date(2026, 2, 30, 0, 1)]],
    ['heure d’hiver (dimanche 25 octobre 2026)', '2026-10-27', [new Date(2026, 9, 24, 23, 59), new Date(2026, 9, 25, 0, 1), new Date(2026, 9, 25, 23, 59), new Date(2026, 9, 26, 0, 1)]],
  ])('%s', (_label, today, starts) => {
    const sessions = starts.map((now, i) => session(`s${String(i)}`, now));
    const cal = buildActivityCalendar(sessions, today);
    const dates = allDays(cal).map((d) => d.date);
    expect(new Set(dates).size).toBe(84);
    // Jours consécutifs : chaque date est la veille + 1 jour calendaire.
    for (let i = 1; i < dates.length; i++) {
      const prev = new Date(`${dates[i - 1] ?? ''}T00:00:00Z`).getTime();
      expect(new Date(`${dates[i] ?? ''}T00:00:00Z`).getTime() - prev).toBe(86_400_000);
    }
    expect(cal.weeks.every((w) => mondayIndex(w[0]?.date ?? '') === 0)).toBe(true);
    const filled = allDays(cal).filter((d) => d.filled).map((d) => [d.date, d.sessionCount]);
    expect(filled).toEqual(sessions.reduce<[string, number][]>((acc, s) => {
      const last = acc.at(-1);
      if (last?.[0] === s.date) last[1] += 1;
      else acc.push([s.date, 1]);
      return acc;
    }, []));
    expect(filled).toHaveLength(3);
  });
});

describe('Étiquettes de mois', () => {
  it('sur la colonne du 1er du mois ; jamais deux étiquettes à moins de 3 colonnes', () => {
    const cal = buildActivityCalendar([], '2026-10-06'); // du 20 juillet au 11 octobre
    const labels = monthLabels(cal);
    // Juillet (colonne 0) est remplacé par août, qui commence dès la colonne 1 (trop proche).
    expect(labels).toEqual([
      { column: 1, month: 8 },
      { column: 6, month: 9 },
      { column: 10, month: 10 },
    ]);
    // Mois bien entamé en première colonne : gardé.
    expect(monthLabels(buildActivityCalendar([], '2026-11-24')).map((l) => l.month)).toEqual([9, 10, 11]);
    for (let i = 1; i < labels.length; i++) expect((labels[i]?.column ?? 0) - (labels[i - 1]?.column ?? 0)).toBeGreaterThanOrEqual(3);
    // Septembre commence le mardi 1er : colonne de la semaine du 31 août.
    expect(labels.find((l) => l.month === 9)?.column).toBe(6);
  });
});
