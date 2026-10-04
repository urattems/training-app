import type { ReactNode } from 'react';
import styles from './Switch.module.css';

interface SwitchProps {
  label: ReactNode;
  checked: boolean;
  disabled?: boolean;
  /** Texte d'aide sous le libellé (relié par `aria-describedby`). */
  hint?: ReactNode;
  hintId?: string;
  onChange: (checked: boolean) => void;
}

/** Interrupteur natif (`input role="switch"`) dessiné comme un interrupteur iOS ; ligne entière cliquable. */
export function Switch({ label, checked, disabled = false, hint, hintId, onChange }: SwitchProps) {
  return (
    <label className={styles.row}>
      <span className={styles.text}>
        <span>{label}</span>
        {hint !== undefined && (
          <span id={hintId} className={styles.hint}>
            {hint}
          </span>
        )}
      </span>
      <input
        type="checkbox"
        role="switch"
        className={styles.switch}
        checked={checked}
        disabled={disabled}
        aria-describedby={hint !== undefined ? hintId : undefined}
        onChange={(e) => {
          onChange(e.target.checked);
        }}
      />
    </label>
  );
}
