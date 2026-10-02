import { useState } from 'react';
import { strings } from '../i18n/strings';
import styles from './ErrorDetails.module.css';

/** « Afficher les détails » : nom et message techniques de l'erreur, repliés par défaut. */
export function ErrorDetails({ details }: { details: readonly string[] }) {
  const [open, setOpen] = useState(false);
  if (details.length === 0) return null;
  return (
    <div>
      <button
        type="button"
        className={styles.toggle}
        aria-expanded={open}
        onClick={() => {
          setOpen((v) => !v);
        }}
      >
        {open ? strings.importFlow.hideDetails : strings.importFlow.showDetails}
      </button>
      {open && (
        <ul className={styles.details}>
          {details.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
