import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChartLine, ChevronRight, History, X } from 'lucide-react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { Badge } from '../../components/Badge';
import { Card, Eyebrow } from '../../components/Card';
import { EmptyState } from '../../components/EmptyState';
import { LoadingState } from '../../components/LoadingState';
import { IconLink, Page } from '../../components/Page';
import { buildChartSeries, type ChartPoint } from '../../domain/chart';
import { formatActualSet, formatPerformance, workoutStatusLabel } from '../../domain/display';
import {
  chartMetricFor,
  formatLoadDelta,
  getExerciseEntries,
  getExerciseLoadHistory,
  getExerciseRepHistory,
  getExerciseStats,
  isPerformedSet,
  lastLoadDelta,
  PERIODS,
  type ExerciseSummary,
  type Period,
} from '../../domain/stats';
import type { WorkoutSession } from '../../domain/types';
import { useTrackedExercises, useWorkouts } from '../../hooks/useData';
import { useToday } from '../../hooks/useToday';
import { strings } from '../../i18n/strings';
import { formatDayLong, formatDayShort } from '../../utils/format';
import { formatDecimal, formatKg } from '../../utils/numbers';
import { historyDetailPath } from '../history/paths';
import { ProgressChart } from './ProgressChart';
import styles from './ProgressPage.module.css';

const t = strings.progressPage;
const DEFAULT_PERIOD: Period = '3M';
const RECENT_COUNT = 5;

const isPeriod = (value: string | null): value is Period => PERIODS.some((p) => p === value);

export const progressPath = (exerciseId: string): string => `/progress/${encodeURIComponent(exerciseId)}`;

/** Exercice affiché par défaut : le plus récemment travaillé. */
const mostRecent = (exercises: ExerciseSummary[]): ExerciseSummary | undefined =>
  exercises.reduce<ExerciseSummary | undefined>((best, e) => (best === undefined || e.lastDate > best.lastDate ? e : best), undefined);

/**
 * Progression (SPEC §7.8) : sélecteur d'exercice → graphique → période → stats → historique récent.
 * Chargée à la demande (lazy) : Recharts n'alourdit pas le bundle initial.
 */
export default function ProgressPage() {
  const { exerciseId } = useParams();
  const exercises = useTrackedExercises();
  const workouts = useWorkouts();

  const header = {
    title: t.title,
    trailing: (
      <IconLink to="/history" label={strings.history.link}>
        <History aria-hidden />
      </IconLink>
    ),
  };

  if (exercises === undefined || workouts === undefined) {
    return (
      <Page {...header}>
        <LoadingState />
      </Page>
    );
  }
  if (exercises.length === 0) {
    return (
      <Page {...header}>
        <EmptyState icon={<ChartLine />} title={t.emptyTitle} text={t.emptyText} />
      </Page>
    );
  }

  const selected = exercises.find((e) => e.programExerciseId === exerciseId) ?? (exerciseId === undefined ? mostRecent(exercises) : undefined);
  return (
    <Page {...header}>
      <ExerciseSelect exercises={exercises} value={selected?.programExerciseId ?? ''} />
      {selected ? (
        <ExerciseProgress key={selected.programExerciseId} exercise={selected} workouts={workouts} />
      ) : (
        <EmptyState icon={<ChartLine />} title={t.unknownExercise} />
      )}
    </Page>
  );
}

function ExerciseSelect({ exercises, value }: { exercises: ExerciseSummary[]; value: string }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const id = useId();
  return (
    <div className={styles.selectField}>
      <label htmlFor={id} className={styles.fieldLabel}>
        {t.exercise}
      </label>
      <select
        id={id}
        className={styles.select}
        value={value}
        onChange={(e) => {
          const query = searchParams.toString();
          void navigate(`${progressPath(e.target.value)}${query ? `?${query}` : ''}`, { replace: true });
        }}
      >
        {value === '' && <option value="">—</option>}
        {exercises.map((e) => (
          <option key={e.programExerciseId} value={e.programExerciseId}>
            {e.exerciseName}
          </option>
        ))}
      </select>
    </div>
  );
}

function ExerciseProgress({ exercise, workouts }: { exercise: ExerciseSummary; workouts: WorkoutSession[] }) {
  const id = exercise.programExerciseId;
  const today = useToday();
  const [searchParams, setSearchParams] = useSearchParams();
  const periodParam = searchParams.get('periode');
  const period: Period = isPeriod(periodParam) ? periodParam : DEFAULT_PERIOD;
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Séries mémoïsées : recalculées seulement si les séances ou l'exercice changent.
  const data = useMemo(() => {
    const metric = chartMetricFor(workouts, id);
    const repPoints = getExerciseRepHistory(workouts, id);
    return {
      metric,
      lastReps: repPoints.at(-1)?.maxReps ?? null,
      repsRecord: repPoints.length > 0 ? Math.max(...repPoints.map((p) => p.maxReps)) : null,
      source: metric === 'load' ? getExerciseLoadHistory(workouts, id) : repPoints,
      stats: getExerciseStats(workouts, id),
      loadDelta: lastLoadDelta(getExerciseLoadHistory(workouts, id)),
      recent: getExerciseEntries(workouts, id)
        .filter((e) => e.record.actualSets.some(isPerformedSet))
        .reverse()
        .slice(0, RECENT_COUNT),
    };
  }, [workouts, id]);
  const series = useMemo(() => buildChartSeries(data.source, data.metric, period, today), [data, period, today]);

  const formatValue = useCallback((v: number) => (data.metric === 'load' ? formatKg(v) : `${formatDecimal(v)} reps`), [data.metric]);
  const onSelect = useCallback((point: ChartPoint) => {
    setSelectedId((current) => (current === point.workoutId ? null : point.workoutId));
  }, []);

  const visibleSelected = series.points.some((p) => p.workoutId === selectedId) ? selectedId : null;
  const selectedPoint = data.source.find((p) => p.workoutId === visibleSelected);
  const title = data.metric === 'load' ? t.loadTitle : t.repsTitle;

  return (
    <>
      <div className={styles.periods} role="group" aria-label={t.period}>
        {PERIODS.map((p) => (
          <button
            key={p}
            type="button"
            className={[styles.period, p === period && styles.periodActive].filter(Boolean).join(' ')}
            aria-pressed={p === period}
            aria-label={t.periodLabels[p]}
            onClick={() => {
              const next = new URLSearchParams(searchParams);
              next.set('periode', p);
              setSearchParams(next, { replace: true });
            }}
          >
            {t.periods[p]}
          </button>
        ))}
      </div>

      <Card className={styles.chartCard}>
        <Eyebrow>{title}</Eyebrow>
        {data.metric === 'reps' && <p className={styles.note}>{t.repsNote}</p>}
        {series.points.length === 0 ? (
          <p className={styles.emptyPeriod}>{t.noPointsInPeriod}</p>
        ) : (
          <ProgressChart
            series={series}
            label={t.chartLabel(title, series.points.length)}
            formatValue={formatValue}
            selectedId={visibleSelected}
            onSelect={onSelect}
          />
        )}
      </Card>

      {selectedPoint ? (
        <PointCard
          exerciseName={exercise.exerciseName}
          date={selectedPoint.date}
          workoutId={selectedPoint.workoutId}
          valueLabel={data.metric === 'load' ? t.maxLoad : t.maxReps}
          value={formatValue('maxLoadKg' in selectedPoint ? selectedPoint.maxLoadKg : selectedPoint.maxReps)}
          sets={selectedPoint.sets.map(formatActualSet)}
          onClose={() => {
            setSelectedId(null);
          }}
        />
      ) : (
        series.points.length > 0 && <p className={styles.hint}>{t.tapHint}</p>
      )}

      <StatsCard
        metric={data.metric}
        stats={data.stats}
        loadDelta={data.loadDelta}
        lastReps={data.lastReps}
        repsRecord={data.repsRecord}
        formatValue={formatValue}
      />

      <Card aria-labelledby="recent-title">
        <Eyebrow id="recent-title">{t.recent}</Eyebrow>
        <ul className={styles.recent}>
          {data.recent.map((entry) => (
            <li key={entry.workoutId}>
              <Link to={historyDetailPath(entry.workoutId)} className={styles.recentRow}>
                <span className={styles.recentHead}>
                  <span className={styles.recentDate}>{formatDayShort(entry.date)}</span>
                  {entry.status === 'abandoned' && <Badge tone="warning">{workoutStatusLabel(entry.status)}</Badge>}
                </span>
                <span className={styles.recentPerf}>{formatPerformance(entry.record.actualSets)}</span>
                <ChevronRight aria-hidden className={styles.chevron} />
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}

interface PointCardProps {
  exerciseName: string;
  date: string;
  workoutId: string;
  valueLabel: string;
  value: string;
  sets: string[];
  onClose: () => void;
}

/** Carte de détail d'un point : grande, lisible au doigt (pas un mini-tooltip). */
function PointCard({ exerciseName, date, workoutId, valueLabel, value, sets, onClose }: PointCardProps) {
  const cardRef = useRef<HTMLElement>(null);
  // À chaque point touché, la carte entière (lien « Voir la séance » compris) devient visible,
  // au-dessus de la barre basse (scroll-margin-bottom).
  useEffect(() => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    cardRef.current?.scrollIntoView({ block: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' });
  }, [workoutId]);
  return (
    <Card ref={cardRef} className={styles.pointCard} aria-labelledby="point-title" aria-live="polite">
      <div className={styles.pointHeader}>
        <div>
          <p id="point-title" className={styles.pointDate}>
            {formatDayLong(date)}
          </p>
          <p className={styles.pointExercise}>{exerciseName}</p>
        </div>
        <button type="button" className={styles.closeButton} aria-label={strings.common.close} onClick={onClose}>
          <X aria-hidden />
        </button>
      </div>
      <p className={styles.pointValue}>
        <span className={styles.pointValueLabel}>{valueLabel}</span>
        {value}
      </p>
      <ol className={styles.pointSets}>
        {sets.map((set, i) => (
          <li key={i}>
            <span className={styles.muted}>{strings.history.actualSet(i + 1)}</span>
            <span>{set}</span>
          </li>
        ))}
      </ol>
      <Link to={historyDetailPath(workoutId)} className={styles.pointLink}>
        {t.seeWorkout}
      </Link>
    </Card>
  );
}

interface StatsCardProps {
  metric: 'load' | 'reps';
  stats: ReturnType<typeof getExerciseStats>;
  loadDelta: number | null;
  lastReps: number | null;
  repsRecord: number | null;
  formatValue: (v: number) => string;
}

/** Stats hiérarchisées (SPEC §7.8) : dernière valeur, record, volume, nombre de séances. */
function StatsCard({ metric, stats, loadDelta, lastReps, repsRecord, formatValue }: StatsCardProps) {
  const lastValue = metric === 'load' ? stats.lastLoadKg : lastReps;
  return (
    <Card aria-labelledby="stats-title" className={styles.stats}>
      <div>
        <Eyebrow id="stats-title">{metric === 'load' ? t.lastLoad : t.lastReps}</Eyebrow>
        <p className={styles.bigValue}>{lastValue !== null ? formatValue(lastValue) : '—'}</p>
        {metric === 'load' && loadDelta !== null && <p className={styles.delta}>{formatLoadDelta(loadDelta)}</p>}
      </div>
      <dl className={styles.statGrid}>
        <div>
          <dt>{metric === 'load' ? t.record : t.recordReps}</dt>
          <dd>
            {metric === 'load'
              ? stats.bestLoadKg !== null
                ? formatKg(stats.bestLoadKg)
                : '—'
              : repsRecord !== null
                ? `${formatDecimal(repsRecord)} reps`
                : '—'}
          </dd>
          {metric === 'load' && stats.bestLoadDate && <dd className={styles.statSub}>{formatDayShort(stats.bestLoadDate)}</dd>}
        </div>
        {metric === 'load' && (
          <div>
            <dt>{t.lastVolume}</dt>
            <dd>{stats.lastSessionVolumeKg !== null ? formatKg(stats.lastSessionVolumeKg) : '—'}</dd>
            {stats.maxSessionVolumeKg !== null && <dd className={styles.statSub}>max {formatKg(stats.maxSessionVolumeKg)}</dd>}
          </div>
        )}
        <div>
          <dt>{t.sessions}</dt>
          <dd>{stats.completedSessionCount}</dd>
          <dd className={styles.statSub}>{t.sessionsHint}</dd>
        </div>
      </dl>
      {metric === 'load' && stats.bestSet && (
        <p className={styles.bestSet}>
          <span className={styles.muted}>{t.bestSet} : </span>
          {stats.bestSet.reps} × {formatKg(stats.bestSet.weightKg)}
        </p>
      )}
    </Card>
  );
}
