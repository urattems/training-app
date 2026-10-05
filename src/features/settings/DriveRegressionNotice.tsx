import { useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { Button } from '../../components/Button';
import { ConfirmSheet } from '../../components/ConfirmSheet';
import { Sheet } from '../../components/Sheet';
import type { RegressionInfo } from '../../domain/driveOutbox';
import { strings } from '../../i18n/strings';
import { resolveDriveRegression } from '../../services/driveOutbox';
import { sendDriveNow } from '../../services/driveScheduler';
import styles from './DriveRegressionNotice.module.css';

const t = strings.drive;

/**
 * Refus de régression (spec §8.2), affiché dans Paramètres ET sur l'accueil : rien n'a été écrasé,
 * la sauvegarde automatique est en pause jusqu'au choix de l'utilisateur.
 * - « Restaurer depuis mon Drive » : explication pas à pas (la pause reste) ;
 * - « Remplacer quand même » : confirmation explicite, puis renvoi avec `force: true` ;
 * - « Ignorer » : la sauvegarde en attente est abandonnée.
 */
export function DriveRegressionNotice({ regression }: { regression: RegressionInfo }) {
  const [explaining, setExplaining] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const { current, incoming } = regression;

  return (
    <div className={styles.notice} role="alert" aria-labelledby="drive-regression-title">
      <p id="drive-regression-title" className={styles.title}>
        <ShieldAlert aria-hidden className={styles.icon} />
        {t.regressionTitle}
      </p>
      <p>{t.regressionText(current.sessions, current.weights, incoming.sessions, incoming.weights)}</p>
      <div className={styles.actions}>
        <Button
          variant="primary"
          fullWidth
          onClick={() => {
            setExplaining(true);
          }}
        >
          {t.regressionRestore}
        </Button>
        <Button
          variant="secondary"
          fullWidth
          onClick={() => {
            setConfirming(true);
          }}
        >
          {t.regressionReplace}
        </Button>
        <Button variant="ghost" fullWidth onClick={() => void resolveDriveRegression('ignore')}>
          {t.regressionIgnore}
        </Button>
      </div>

      {explaining && (
        <Sheet
          title={t.regressionRestoreTitle}
          onClose={() => {
            setExplaining(false);
          }}
          footer={
            <Button
              size="lg"
              fullWidth
              onClick={() => {
                setExplaining(false);
              }}
            >
              {t.regressionRestoreOk}
            </Button>
          }
        >
          <ol className={styles.steps}>
            {t.regressionRestoreSteps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </Sheet>
      )}
      {confirming && (
        <ConfirmSheet
          title={t.regressionReplaceTitle}
          confirmLabel={t.regressionReplaceConfirm}
          confirmVariant="danger"
          onConfirm={() => {
            setConfirming(false);
            void resolveDriveRegression('replace').then(() => sendDriveNow());
          }}
          onCancel={() => {
            setConfirming(false);
          }}
        >
          <p>{t.regressionReplaceText}</p>
        </ConfirmSheet>
      )}
    </div>
  );
}
