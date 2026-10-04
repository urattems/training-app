import { useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { RefreshCw } from 'lucide-react';
import { Button } from '../components/Button';
import { getConnectionIssue, subscribeConnectionIssue } from '../db/connectionStatus';
import { strings } from '../i18n/strings';
import styles from './ConnectionNotice.module.css';

const t = strings.connection;

/**
 * Message plein écran quand un autre onglet de l'app bloque la mise à jour de la base, ou
 * quand une version plus récente l'a ouverte ailleurs. Jamais d'erreur obscure : une phrase
 * claire, l'assurance que les données sont conservées, un bouton pour recharger.
 */
export function ConnectionNotice() {
  const issue = useSyncExternalStore(subscribeConnectionIssue, getConnectionIssue, getConnectionIssue);
  if (issue === null) return null;
  const blocked = issue === 'blocked';
  // Hors de #root : une feuille ouverte rend #root inerte, ce message doit rester utilisable.
  return createPortal(
    <div className={styles.overlay} role="alertdialog" aria-modal="true" aria-labelledby="connection-title" aria-describedby="connection-text">
      <div className={styles.panel}>
        <h2 id="connection-title" className={styles.title}>
          {blocked ? t.blockedTitle : t.supersededTitle}
        </h2>
        <p id="connection-text" className={styles.text}>
          {blocked ? t.blockedText : t.supersededText}
        </p>
        <p className={styles.safe}>{t.dataSafe}</p>
        <Button
          size="lg"
          fullWidth
          icon={<RefreshCw aria-hidden />}
          onClick={() => {
            window.location.reload();
          }}
        >
          {blocked ? t.retry : t.reload}
        </Button>
      </div>
    </div>,
    document.body,
  );
}
