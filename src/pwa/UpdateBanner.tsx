import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { useInProgressWorkout } from '../hooks/useData';
import { strings } from '../i18n/strings';
import { shouldShowUpdateBanner } from './updatePolicy';
import styles from './UpdateBanner.module.css';

/** Vérification périodique d'une nouvelle version quand l'app reste ouverte (PWA iOS). */
const UPDATE_CHECK_MS = 60 * 60 * 1000;

/**
 * Enregistre le service worker (registerType « prompt ») et propose la mise à jour.
 * Hors contexte sécurisé (HTTP sur IP locale), les service workers n'existent pas :
 * l'enregistrement est simplement ignoré.
 */
export function UpdateBanner() {
  const [dismissed, setDismissed] = useState(false);
  const inProgress = useInProgressWorkout();
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      setInterval(() => {
        if (navigator.onLine) void registration.update();
      }, UPDATE_CHECK_MS);
    },
    onRegisterError(error) {
      console.error(error);
    },
  });

  const workoutInProgress = inProgress === undefined ? undefined : inProgress !== null;
  if (!shouldShowUpdateBanner({ needRefresh, workoutInProgress, dismissed })) return null;

  return (
    <UpdateBannerView
      onUpdate={() => void updateServiceWorker(true)}
      onDismiss={() => {
        setDismissed(true);
      }}
    />
  );
}

/** Bannière discrète ; « Mettre à jour » active la nouvelle version puis recharge. */
export function UpdateBannerView({ onUpdate, onDismiss }: { onUpdate: () => void; onDismiss: () => void }) {
  return (
    <div className={styles.banner} role="status">
      <RefreshCw aria-hidden className={styles.icon} />
      <p className={styles.text}>{strings.update.available}</p>
      <button type="button" className={styles.later} onClick={onDismiss}>
        {strings.update.later}
      </button>
      <button type="button" className={styles.update} onClick={onUpdate}>
        {strings.update.action}
      </button>
    </div>
  );
}
