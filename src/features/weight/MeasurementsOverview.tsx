import { Card, Eyebrow } from '../../components/Card';
import { latestComplete, latestValue, MEASUREMENT_ZONES, measurementTotal } from '../../domain/measurements';
import type { MeasurementEntry } from '../../domain/types';
import { strings } from '../../i18n/strings';
import { formatDayLong } from '../../utils/format';
import { formatCm } from '../../utils/numbers';
import styles from './MeasurementsPage.module.css';

const t = strings.measurements;

/**
 * Vue d'ensemble des mensurations. Carte « Dernière mensuration » : dernière valeur de chaque zone
 * (ou « — »), puis le Total de la dernière prise COMPLÈTE avec sa date (ligne secondaire).
 */
export function MeasurementsOverview({ entries }: { entries: readonly MeasurementEntry[]; onEdit: (entry: MeasurementEntry) => void }) {
  const complete = latestComplete(entries);
  const total = complete ? measurementTotal(complete) : null;
  return (
    <Card aria-labelledby="measurements-latest-title">
      <Eyebrow id="measurements-latest-title">{t.latestTitle}</Eyebrow>
      <ul className={styles.latestList}>
        {MEASUREMENT_ZONES.map((zone) => {
          const last = latestValue(entries, zone.key);
          return (
            <li key={zone.key} className={styles.latestRow}>
              <span>{zone.label}</span>
              <span className={styles.latestValue}>{last ? formatCm(last.value) : '—'}</span>
            </li>
          );
        })}
        <li className={`${styles.latestRow ?? ''} ${styles.totalRow ?? ''}`}>
          <span>{t.total}</span>
          <span className={styles.latestValue}>{total !== null ? formatCm(total) : '—'}</span>
        </li>
      </ul>
      <p className={styles.totalNote}>{complete ? t.totalOn(formatDayLong(complete.date)) : t.noComplete}</p>
    </Card>
  );
}
