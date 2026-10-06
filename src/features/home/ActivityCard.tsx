import { useMemo, useState, type CSSProperties } from 'react';
import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router';
import { Card, Eyebrow } from '../../components/Card';
import { buildActivityCalendar, completedSessionsOn, monthLabels, type ActivityDay } from '../../domain/activity';
import type { WorkoutSession } from '../../domain/types';
import { strings } from '../../i18n/strings';
import { formatDayLong, formatDuration } from '../../utils/format';
import { historyDetailPath } from '../history/paths';
import styles from './ActivityCard.module.css';

const t = strings.activity;
const monthFormatter = new Intl.DateTimeFormat('fr-FR', { month: 'short', timeZone: 'UTC' });
const monthName = (month: number): string => monthFormatter.format(new Date(Date.UTC(2000, month - 1, 1)));

/**
 * Carte « Activité » de l'accueil (V1.4.0) : 12 semaines × 7 jours, un carré par jour, rempli les
 * jours avec au moins une séance TERMINÉE. Binaire, sans score ni série. Le toucher d'une case
 * affiche le détail du jour SOUS la grille. `today` est injecté (date locale `YYYY-MM-DD`).
 */
export function ActivityCard({ workouts, today }: { workouts: readonly WorkoutSession[]; today: string }) {
  const calendar = useMemo(() => buildActivityCalendar(workouts, today), [workouts, today]);
  const [selected, setSelected] = useState<string | null>(null);
  const days = calendar.weeks.flat();
  const selectedDay = days.find((d) => d.date === selected) ?? null;

  return (
    <Card aria-labelledby="activity-title" className={styles.card}>
      <Eyebrow id="activity-title">{t.title}</Eyebrow>
      <div className={styles.grid} role="group" aria-label={t.gridLabel}>
        {monthLabels(calendar).map(({ column, month }) => (
          <span key={column} className={styles.month} style={{ gridColumn: `${String(column + 2)} / span 3` }} aria-hidden>
            {monthName(month)}
          </span>
        ))}
        {t.dayInitials.map((initial, row) => (
          <span key={row} className={styles.initial} style={{ gridRow: row + 2 }} aria-hidden>
            {initial}
          </span>
        ))}
        {calendar.weeks.map((week, column) =>
          week.map((day, row) => (
            <DayButton
              key={day.date}
              day={day}
              selected={day.date === selected}
              style={{ gridColumn: column + 2, gridRow: row + 2 }}
              onSelect={() => {
                setSelected(day.date === selected ? null : day.date);
              }}
            />
          )),
        )}
      </div>
      <p className={styles.summary}>{t.summary(calendar.sessionCount)}</p>
      <div aria-live="polite">{selectedDay && <DayDetail day={selectedDay} workouts={workouts} />}</div>
    </Card>
  );
}

function DayButton({ day, selected, style, onSelect }: { day: ActivityDay; selected: boolean; style: CSSProperties; onSelect: () => void }) {
  const className = [
    styles.day,
    day.filled && styles.filled,
    day.isFuture && styles.future,
    day.isToday && styles.today,
    selected && styles.selected,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button
      type="button"
      className={className}
      style={style}
      aria-label={t.dayLabel(formatDayLong(day.date), day.sessionCount, day.isFuture, day.isToday)}
      aria-pressed={selected}
      aria-current={day.isToday ? 'date' : undefined}
      onClick={onSelect}
    />
  );
}

function DayDetail({ day, workouts }: { day: ActivityDay; workouts: readonly WorkoutSession[] }) {
  const sessions = completedSessionsOn(workouts, day.date);
  return (
    <section className={styles.detail} aria-label={t.detailLabel(formatDayLong(day.date))}>
      <p className={styles.detailDate}>{formatDayLong(day.date)}</p>
      {sessions.length === 0 ? (
        <p className={styles.detailEmpty}>{day.isFuture ? t.upcoming : t.noSession}</p>
      ) : (
        <ul className={styles.detailList}>
          {sessions.map((s) => (
            <li key={s.id}>
              <Link to={historyDetailPath(s.id)} className={styles.detailLink}>
                <span className={styles.detailName}>{s.sessionName}</span>
                {s.durationSec !== null && <span className={styles.detailMeta}>{formatDuration(s.durationSec)}</span>}
                <ChevronRight aria-hidden className={styles.chevron} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
