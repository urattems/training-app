import { Card, Eyebrow } from '../../components/Card';
import type { ProgramCardio, WorkoutSession } from '../../domain/types';
import { strings } from '../../i18n/strings';
import { formatDuration } from '../../utils/format';
import styles from './CardioSection.module.css';

const t = strings.workoutScreen;

/** Section Cardio de l'écran séance (SPEC §7.6). La saisie arrive au J3b. */
export function CardioSection({ workout, programCardio }: { workout: WorkoutSession; programCardio: ProgramCardio | null }) {
  if (programCardio?.enabled !== true && workout.cardioRecords.length === 0) return null;
  return (
    <Card aria-labelledby="cardio-title">
      <Eyebrow id="cardio-title">{programCardio?.label || t.cardioTitle}</Eyebrow>
      {programCardio?.targetDurationMin != null && <p className={styles.target}>{t.cardioTarget(programCardio.targetDurationMin)}</p>}
      {programCardio?.notes && <p className={styles.notes}>{programCardio.notes}</p>}
      {workout.cardioRecords.length === 0 ? (
        <p className={styles.empty}>{t.noCardio}</p>
      ) : (
        <ul className={styles.list}>
          {workout.cardioRecords.map((entry, i) => (
            <li key={i}>
              {[entry.name || entry.type, entry.durationSec !== null ? formatDuration(entry.durationSec) : null].filter(Boolean).join(' · ')}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
