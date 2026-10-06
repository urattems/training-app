import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Check, Pencil, X } from 'lucide-react';
import { useSearchParams } from 'react-router';
import { Button } from '../../components/Button';
import { Card, Eyebrow } from '../../components/Card';
import type { ChartPoint } from '../../domain/chart';
import {
  buildMeasurementSeries,
  DEFAULT_MEASUREMENT_PERIOD,
  departure,
  isMeasurementPeriod,
  latestComplete,
  latestValue,
  MEASUREMENT_PERIODS,
  MEASUREMENT_ZONES,
  measurementStats,
  measurementTotal,
  measurementValueAxis,
  previousPoint,
  seriesFromSlug,
  seriesSlug,
  variation,
  type MeasurementPeriod,
  type MeasurementSeriesKey,
} from '../../domain/measurements';
import type { MeasurementEntry } from '../../domain/types';
import { useToday } from '../../hooks/useToday';
import { strings } from '../../i18n/strings';
import { formatDayLong, formatDayShort } from '../../utils/format';
import { formatCm, formatSignedCm } from '../../utils/numbers';
import { ProgressChart } from '../progress/ProgressChart';
import progressStyles from '../progress/ProgressPage.module.css';
import styles from './MeasurementsPage.module.css';

const t = strings.measurements;
const seriesLabel = (key: MeasurementSeriesKey): string => (key === 'total' ? t.total : (MEASUREMENT_ZONES.find((z) => z.key === key)?.label ?? t.total));

/**
 * Vue d'ensemble des mensurations (V1.6.0) : UN graphique à la fois (zone ou Total), au-dessus de
 * la carte « Dernière mensuration » dont chaque ligne sélectionne la série affichée. Périodes
 * propres (3M · 6M · 1A · Tout, défaut Tout) ; `?periode=` et `?zone=` gardent l'état dans l'URL.
 * Départ, Aujourd'hui et Variation sont calculés sur TOUTES les prises ; couleur neutre.
 */
export function MeasurementsOverview({ entries, onEdit }: { entries: readonly MeasurementEntry[]; onEdit: (entry: MeasurementEntry) => void }) {
  const today = useToday();
  const [searchParams, setSearchParams] = useSearchParams();
  const periodParam = searchParams.get('periode');
  const period: MeasurementPeriod = isMeasurementPeriod(periodParam) ? periodParam : DEFAULT_MEASUREMENT_PERIOD;
  const selected = seriesFromSlug(searchParams.get('zone'));
  const pointParam = searchParams.get('point');

  const setParam = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) next.delete(key);
      else next.set(key, value);
    }
    setSearchParams(next, { replace: true });
  };

  const series = useMemo(() => buildMeasurementSeries(entries, selected, period, today), [entries, selected, period, today]);
  const stats = useMemo(() => measurementStats(entries, selected, period, today), [entries, selected, period, today]);
  const label = seriesLabel(selected);
  const selectedPoint = series.points.find((p) => p.date === pointParam) ?? null;
  const selectedEntry = selectedPoint ? (entries.find((e) => e.date === selectedPoint.date) ?? null) : null;

  const onSelect = useCallback(
    (point: ChartPoint) => {
      const next = new URLSearchParams(searchParams);
      if (next.get('point') === point.date) next.delete('point');
      else next.set('point', point.date);
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );
  const pointLabel = useCallback((point: ChartPoint) => t.pointLabel(formatDayLong(point.date), formatCm(point.value)), []);
  const axis = useMemo(() => measurementValueAxis(selected), [selected]);

  return (
    <>
      <div className={`${progressStyles.periods ?? ''} ${styles.periods4 ?? ''}`} role="group" aria-label={strings.progressPage.period}>
        {MEASUREMENT_PERIODS.map((p) => (
          <button
            key={p}
            type="button"
            className={[progressStyles.period, p === period && progressStyles.periodActive].filter(Boolean).join(' ')}
            aria-pressed={p === period}
            aria-label={strings.progressPage.periodLabels[p]}
            onClick={() => {
              setParam({ periode: p, point: null });
            }}
          >
            {strings.progressPage.periods[p]}
          </button>
        ))}
      </div>

      <Card className={progressStyles.chartCard}>
        <Eyebrow>{`${label} (${t.unit})`}</Eyebrow>
        {series.points.length === 0 ? (
          <div className={styles.emptyPeriod}>
            <p className={progressStyles.emptyPeriod}>{t.noPointsInPeriod}</p>
            {period !== 'all' && (
              <Button
                variant="ghost"
                onClick={() => {
                  setParam({ periode: 'all', point: null });
                }}
              >
                {t.showAll}
              </Button>
            )}
          </div>
        ) : (
          <ProgressChart
            series={series}
            label={t.chartLabel(label, series.points.length)}
            formatValue={formatCm}
            selectedId={selectedPoint?.date ?? null}
            onSelect={onSelect}
            valueAxisFor={axis}
            pointLabel={pointLabel}
          />
        )}
      </Card>

      {selectedPoint && selectedEntry ? (
        <PointCard
          entries={entries}
          seriesKey={selected}
          date={selectedPoint.date}
          value={selectedPoint.value}
          onEdit={() => {
            onEdit(selectedEntry);
          }}
          onClose={() => {
            setParam({ point: null });
          }}
        />
      ) : (
        series.points.length > 0 && <p className={progressStyles.hint}>{t.tapHint}</p>
      )}

      <SummaryCard entries={entries} seriesKey={selected} label={label} stats={stats} />

      <LatestCard
        entries={entries}
        selected={selected}
        onSelect={(key) => {
          setParam({ zone: seriesSlug(key), point: null });
        }}
      />
    </>
  );
}

/** DÉPART / AUJOURD'HUI / VARIATION (toutes les prises, couleur neutre), puis min, max, nombre sur la période. */
function SummaryCard({ entries, seriesKey, label, stats }: {
  entries: readonly MeasurementEntry[];
  seriesKey: MeasurementSeriesKey;
  label: string;
  stats: ReturnType<typeof measurementStats>;
}) {
  const first = departure(entries, seriesKey);
  const last = latestValue(entries, seriesKey);
  const change = variation(entries, seriesKey);
  return (
    <Card aria-labelledby="measurement-summary-title">
      <Eyebrow id="measurement-summary-title">{t.statsTitle(label)}</Eyebrow>
      <dl className={styles.summary}>
        <div className={styles.summaryCard}>
          <dt>{t.departure}</dt>
          <dd className={styles.summaryValue}>{first ? formatCm(first.value) : '—'}</dd>
          {first && <dd className={styles.summaryDate}>{formatDayShort(first.date)}</dd>}
        </div>
        <div className={styles.summaryCard}>
          <dt>{t.today}</dt>
          <dd className={styles.summaryValue}>{last ? formatCm(last.value) : '—'}</dd>
          {last && <dd className={styles.summaryDate}>{formatDayShort(last.date)}</dd>}
        </div>
        <div className={styles.summaryCard}>
          <dt>{t.variation}</dt>
          <dd className={styles.summaryValue}>{change === null ? '—' : formatSignedCm(change)}</dd>
        </div>
      </dl>
      <dl className={progressStyles.statGrid}>
        <div>
          <dt>{t.min}</dt>
          <dd>{stats.min ? formatCm(stats.min.value) : '—'}</dd>
          {stats.min && <dd className={progressStyles.statSub}>{formatDayShort(stats.min.date)}</dd>}
        </div>
        <div>
          <dt>{t.max}</dt>
          <dd>{stats.max ? formatCm(stats.max.value) : '—'}</dd>
          {stats.max && <dd className={progressStyles.statSub}>{formatDayShort(stats.max.date)}</dd>}
        </div>
      </dl>
      <p className={styles.totalNote}>{t.count(stats.count)}</p>
    </Card>
  );
}

/**
 * Carte « Dernière mensuration » : chaque ligne est un bouton qui SÉLECTIONNE la série affichée
 * (aria-pressed ; coche et texte en gras, pas seulement une couleur). Le Total est la dernière ligne.
 */
function LatestCard({ entries, selected, onSelect }: {
  entries: readonly MeasurementEntry[];
  selected: MeasurementSeriesKey;
  onSelect: (key: MeasurementSeriesKey) => void;
}) {
  const complete = latestComplete(entries);
  const total = complete ? measurementTotal(complete) : null;
  const rows: { key: MeasurementSeriesKey; label: string; value: string }[] = [
    ...MEASUREMENT_ZONES.map((zone) => {
      const last = latestValue(entries, zone.key);
      return { key: zone.key, label: zone.label, value: last ? formatCm(last.value) : '—' };
    }),
    { key: 'total', label: t.total, value: total !== null ? formatCm(total) : '—' },
  ];
  return (
    <Card aria-labelledby="measurements-latest-title">
      <Eyebrow id="measurements-latest-title">{t.latestTitle}</Eyebrow>
      <ul className={styles.latestList}>
        {rows.map((row) => {
          const isSelected = row.key === selected;
          return (
            <li key={row.key}>
              <button
                type="button"
                className={[styles.latestRow, styles.latestButton, row.key === 'total' && styles.totalRow, isSelected && styles.latestSelected].filter(Boolean).join(' ')}
                aria-pressed={isSelected}
                aria-label={`${t.selectLabel(row.label)} (${row.value === '—' ? t.noValue : row.value})`}
                onClick={() => {
                  onSelect(row.key);
                }}
              >
                <span className={styles.latestLabel}>
                  <Check aria-hidden className={isSelected ? styles.checkOn : styles.checkOff} />
                  {row.label}
                </span>
                <span className={styles.latestValue}>{row.value}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className={styles.totalNote}>{complete ? t.totalOn(formatDayLong(complete.date)) : t.noComplete}</p>
    </Card>
  );
}

/** Détail d'un point : date, mesure, écart avec la valeur précédente de la série (neutre), modifier. */
function PointCard({ entries, seriesKey, date, value, onEdit, onClose }: {
  entries: readonly MeasurementEntry[];
  seriesKey: MeasurementSeriesKey;
  date: string;
  value: number;
  onEdit: () => void;
  onClose: () => void;
}) {
  const cardRef = useRef<HTMLElement>(null);
  const previous = previousPoint(entries, seriesKey, date);
  useEffect(() => {
    // Effet (pas de minuteur) : la carte entière reste visible au-dessus de la barre basse.
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    cardRef.current?.scrollIntoView({ block: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' });
  }, [date]);
  return (
    <Card ref={cardRef} className={progressStyles.pointCard} aria-labelledby="measurement-point-title" aria-live="polite">
      <div className={progressStyles.pointHeader}>
        <p id="measurement-point-title" className={progressStyles.pointDate}>
          {formatDayLong(date)}
        </p>
        <button type="button" className={progressStyles.closeButton} aria-label={strings.common.close} onClick={onClose}>
          <X aria-hidden />
        </button>
      </div>
      <p className={progressStyles.pointValue}>
        <span className={progressStyles.pointValueLabel}>{t.pointValue}</span>
        {formatCm(value)}
      </p>
      <p className={styles.pointDelta}>
        <span className={progressStyles.muted}>{t.pointDelta} : </span>
        {previous ? t.deltaSince(formatSignedCm(Math.round((value - previous.value) * 10) / 10), formatDayShort(previous.date)) : t.firstValue}
      </p>
      <Button variant="secondary" fullWidth icon={<Pencil aria-hidden />} onClick={onEdit}>
        {t.editLabel(formatDayLong(date))}
      </Button>
    </Card>
  );
}
