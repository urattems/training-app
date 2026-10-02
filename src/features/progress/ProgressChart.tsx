import { memo, useRef, type KeyboardEvent } from 'react';
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts';
import { valueAxis, type ChartPoint, type ChartSeries } from '../../domain/chart';
import { useElementWidth } from '../../hooks/useElementWidth';
import { formatDayLong, formatDayShort } from '../../utils/format';
import { formatDecimal } from '../../utils/numbers';
import { strings } from '../../i18n/strings';
import styles from './ProgressChart.module.css';

const CHART_HEIGHT = 220;
const HIT_RADIUS = 22; // zone tactile de 44 px autour de chaque point

const timeToDate = (t: number): string => new Date(t).toISOString().slice(0, 10);

interface ProgressChartProps {
  series: ChartSeries;
  /** Libellé accessible du graphique. */
  label: string;
  /** Mise en forme d'une valeur (« 47,5 kg », « 12 reps »). */
  formatValue: (value: number) => string;
  selectedId: string | null;
  onSelect: (point: ChartPoint) => void;
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
export const ProgressChart = memo(function ProgressChart({ series, label, formatValue, selectedId, onSelect }: ProgressChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const width = useElementWidth(containerRef);
  const yAxis = valueAxis(series.points);

  const renderDot = ({ cx, cy, payload }: DotProps) => {
    if (cx === undefined || cy === undefined || !payload) return <g />;
    const selected = payload.workoutId === selectedId;
    const select = () => {
      onSelect(payload);
    };
    const onKeyDown = (event: KeyboardEvent<SVGCircleElement>) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        select();
      }
    };
    return (
      <g key={payload.workoutId}>
        <circle cx={cx} cy={cy} r={selected ? 7 : 4.5} className={selected ? styles.dotSelected : styles.dot} />
        <circle
          cx={cx}
          cy={cy}
          r={HIT_RADIUS}
          className={styles.hitArea}
          role="button"
          tabIndex={0}
          aria-pressed={selected}
          aria-label={strings.progressPage.pointLabel(formatDayLong(payload.date), formatValue(payload.value))}
          onClick={select}
          onKeyDown={onKeyDown}
        />
      </g>
    );
  };

  return (
    <div ref={containerRef} className={styles.chart} role="figure" aria-label={label}>
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
