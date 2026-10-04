import { memo, useRef, type KeyboardEvent, type MouseEvent } from 'react';
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts';
import { valueAxis, type ChartPoint, type ChartSeries, type ValueAxisOptions } from '../../domain/chart';
import { useElementWidth } from '../../hooks/useElementWidth';
import { formatDayLong, formatDayShort } from '../../utils/format';
import { formatDecimal } from '../../utils/numbers';
import { strings } from '../../i18n/strings';
import styles from './ProgressChart.module.css';

const CHART_HEIGHT = 220;
const HIT_RADIUS = 22; // zone tactile de 44 px autour de chaque point

const timeToDate = (t: number): string => new Date(t).toISOString().slice(0, 10);

/** Écart horizontal maximal (px) entre le doigt et un point pour le sélectionner. */
const MAX_PICK_DISTANCE = 32;

/**
 * Point le plus proche du doigt, d'après les positions RÉELLES des points dessinés.
 * Indispensable quand les points sont serrés (pesées quotidiennes) : les zones tactiles de
 * 44 px se chevauchent et la plus haute dans le DOM capterait le toucher.
 * `null` sans coordonnées exploitables (clavier, lecteur d'écran, jsdom) ou si rien n'est proche.
 */
function nearestPointId(container: HTMLElement | null, event: MouseEvent): string | null {
  const svg = container?.querySelector('svg');
  const rect = svg?.getBoundingClientRect();
  if (!svg || !rect || rect.width === 0 || (event.clientX === 0 && event.clientY === 0)) return null;
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  let best: { id: string; dx: number; dy: number } | null = null;
  for (const dot of svg.querySelectorAll<SVGCircleElement>('circle[data-point-id]')) {
    const dx = Math.abs(Number(dot.getAttribute('cx')) - x);
    const dy = Math.abs(Number(dot.getAttribute('cy')) - y);
    if (best === null || dx < best.dx || (dx === best.dx && dy < best.dy)) best = { id: dot.dataset.pointId ?? '', dx, dy };
  }
  return best !== null && best.dx <= MAX_PICK_DISTANCE ? best.id : null;
}

interface ProgressChartProps {
  series: ChartSeries;
  /** Libellé accessible du graphique. */
  label: string;
  /** Mise en forme d'une valeur (« 47,5 kg », « 12 reps »). */
  formatValue: (value: number) => string;
  selectedId: string | null;
  onSelect: (point: ChartPoint) => void;
  /** Axe Y : marges (le poids resserre l'ordonnée sur la plage des données). */
  axis?: ValueAxisOptions;
  /** Libellé accessible d'un point (par défaut : « date : valeur »). */
  pointLabel?: (point: ChartPoint) => string;
}

interface DotProps {
  cx?: number;
  cy?: number;
  payload?: ChartPoint;
}

/**
 * Graphique points + ligne, minimaliste et sans animation (SPEC §7.8).
 * Pas de tooltip Recharts : chaque point est un bouton (zone de 44 px) qui sélectionne
 * la séance ; la carte de détail est rendue hors du graphique, pilotée par l'état React.
 */
export const ProgressChart = memo(function ProgressChart({ series, label, formatValue, selectedId, onSelect, axis, pointLabel }: ProgressChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const width = useElementWidth(containerRef);
  const yAxis = valueAxis(series.points, axis);

  const pointById = (id: string | null) => (id === null ? undefined : series.points.find((p) => p.workoutId === id));

  const renderDot = ({ cx, cy, payload }: DotProps) => {
    if (cx === undefined || cy === undefined || !payload) return <g />;
    const selected = payload.workoutId === selectedId;
    const select = () => {
      onSelect(payload);
    };
    // Toucher / clic : le point le plus proche du doigt ; sinon (clavier, lecteur d'écran) ce point.
    const onClick = (event: MouseEvent<SVGCircleElement>) => {
      event.stopPropagation();
      onSelect(pointById(nearestPointId(containerRef.current, event)) ?? payload);
    };
    const onKeyDown = (event: KeyboardEvent<SVGCircleElement>) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        select();
      }
    };
    return (
      <g key={payload.workoutId}>
        <circle cx={cx} cy={cy} r={selected ? 7 : 4.5} className={selected ? styles.dotSelected : styles.dot} data-point-id={payload.workoutId} />
        <circle
          cx={cx}
          cy={cy}
          r={HIT_RADIUS}
          className={styles.hitArea}
          role="button"
          tabIndex={0}
          aria-pressed={selected}
          aria-label={pointLabel ? pointLabel(payload) : strings.progressPage.pointLabel(formatDayLong(payload.date), formatValue(payload.value))}
          onClick={onClick}
          onKeyDown={onKeyDown}
        />
      </g>
    );
  };

  return (
    <div
      ref={containerRef}
      className={styles.chart}
      role="figure"
      aria-label={label}
      onClick={(event) => {
        // Toucher entre deux points (hors zone tactile) : le point le plus proche, s'il est assez près.
        const point = pointById(nearestPointId(containerRef.current, event));
        if (point) onSelect(point);
      }}
    >
      <LineChart width={width} height={CHART_HEIGHT} data={series.points} margin={{ top: 16, right: 16, bottom: 4, left: 0 }}>
        <CartesianGrid vertical={false} className={styles.grid} />
        <XAxis
          dataKey="t"
          type="number"
          scale="time"
          domain={series.domain}
          ticks={series.ticks}
          // Pas d'allowDataOverflow : il masquerait (clipPath) les points en bord de domaine.
          // Marge en pixels : un point en bord de domaine (premier, dernier, aujourd'hui) n'est jamais coupé.
          padding={{ left: 14, right: 14 }}
          tickFormatter={(t: number) => formatDayShort(timeToDate(t))}
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          className={styles.axis}
        />
        <YAxis
          dataKey="value"
          domain={yAxis.domain}
          ticks={yAxis.ticks}
          width={44}
          tickFormatter={(v: number) => formatDecimal(v)}
          tickLine={false}
          axisLine={false}
          className={styles.axis}
        />
        <Line dataKey="value" type="linear" dot={renderDot} activeDot={false} isAnimationActive={false} />
      </LineChart>
    </div>
  );
});
