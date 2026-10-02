import { Target } from 'lucide-react';
import { formatTargetSet } from '../../domain/display';
import type { ProgramSet } from '../../domain/types';
import { strings } from '../../i18n/strings';
import styles from './TargetSets.module.css';

/**
 * Bloc OBJECTIF, en lecture seule. Style volontairement distinct du réalisé :
 * fond grisé, bordure pointillée, texte secondaire, jamais de champ (SPEC §7.4).
 */
export function TargetSets({ sets, restSec }: { sets: readonly ProgramSet[]; restSec?: number | null }) {
  return (
    <section className={styles.objective} aria-label={strings.program.objective}>
      <p className={styles.label}>
        <Target aria-hidden />
        {strings.program.objective}
      </p>
      <ol className={styles.list}>
        {sets.map((set) => (
          <li key={set.setNumber} className={styles.row}>
            <span className={styles.setNumber}>{strings.program.setLabel(set.setNumber)}</span>
            <span className={styles.value}>{formatTargetSet(set)}</span>
          </li>
        ))}
      </ol>
      {restSec != null && <p className={styles.rest}>{strings.exercise.restRecommended(restSec)}</p>}
    </section>
  );
}
