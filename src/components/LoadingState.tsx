import { LoaderCircle } from 'lucide-react';
import { strings } from '../i18n/strings';
import styles from './LoadingState.module.css';

/** État de chargement visible pour toute opération asynchrone (SPEC §7.9). */
export function LoadingState({ label = strings.common.loading }: { label?: string }) {
  return (
    <div className={styles.loading} role="status">
      <LoaderCircle className={styles.spinner} aria-hidden />
      <span>{label}</span>
    </div>
  );
}
