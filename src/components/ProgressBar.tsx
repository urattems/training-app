import styles from './ProgressBar.module.css';

/** Barre de progression discrète (« 2 / 6 »). */
export function ProgressBar({ value, max, label }: { value: number; max: number; label: string }) {
  const percent = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className={styles.track} role="progressbar" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-label={label}>
      <div className={styles.fill} style={{ width: `${String(percent)}%` }} />
    </div>
  );
}
