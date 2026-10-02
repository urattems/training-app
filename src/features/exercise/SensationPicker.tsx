import type { Sensation } from '../../domain/types';
import { SENSATIONS } from '../../schemas/history.schema';
import { strings } from '../../i18n/strings';
import styles from './SensationPicker.module.css';

/**
 * Sensation : 5 boutons larges, un seul choix. Retoucher le choix actif le désélectionne.
 * Boutons à bascule (`aria-pressed`) : un radiogroup ne permettrait pas de tout désélectionner.
 */
export function SensationPicker({ value, onChange }: { value: Sensation | null; onChange: (value: Sensation | null) => void }) {
  return (
    <div className={styles.group} role="group" aria-labelledby="sensation-title">
      <h2 id="sensation-title" className={styles.title}>
        {strings.exercise.sensation}
      </h2>
      <div className={styles.options}>
        {SENSATIONS.map((sensation) => {
          const selected = value === sensation;
          return (
            <button
              key={sensation}
              type="button"
              className={[styles.option, selected && styles.selected].filter(Boolean).join(' ')}
              aria-pressed={selected}
              onClick={() => {
                onChange(selected ? null : sensation);
              }}
            >
              {strings.sensations[sensation]}
            </button>
          );
        })}
      </div>
    </div>
  );
}
