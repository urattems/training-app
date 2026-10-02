/**
 * Outils de développement : chargement des données de démo (examples/history-example.json).
 * Ce module n'est importé que si `import.meta.env.DEV` (voir SettingsPage) : il est absent
 * du build de production (vérifié sur dist/).
 */
import { useState } from 'react';
import { Database } from 'lucide-react';
import { Button } from '../../components/Button';
import { Card, Eyebrow } from '../../components/Card';
import { ConfirmSheet } from '../../components/ConfirmSheet';
import { ErrorDetails } from '../../components/ErrorDetails';
import { previewRestore, restoreBackup } from '../../services/importService';
import { toDisplayError, type DisplayError } from '../../utils/errors';
import demoHistory from '../../../examples/history-example.json?raw';
import styles from './SettingsPage.module.css';

/** Textes du mode dev : gardés ici pour ne laisser aucune trace dans le build de production. */
const t = {
  title: 'Développement',
  hint: 'Visible uniquement en mode développement (npm run dev), jamais dans le build de production.',
  loadDemo: 'Charger les données de démo',
  confirmTitle: 'Charger les données de démo ?',
  confirmText:
    'Toutes les données de cette base (ce navigateur, ce port) seront remplacées par examples/history-example.json. Une copie interne des données actuelles est conservée.',
  confirm: 'Remplacer par la démo',
  loaded: (n: number) => `Données de démo chargées : ${n} séances.`,
  error: 'Chargement de la démo impossible',
} as const;

/** Charge la démo via le vrai pipeline de restauration (validation, invariants, copie interne). */
export async function loadDemoData(): Promise<number> {
  const preview = previewRestore(demoHistory);
  if (!preview.ok) throw new Error(preview.error.message);
  await restoreBackup(preview.value.data);
  return preview.value.sessionCount;
}

export default function DevTools() {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<DisplayError | null>(null);

  const load = async () => {
    setBusy(true);
    setError(null);
    try {
      setStatus(t.loaded(await loadDemoData()));
    } catch (e) {
      setError(toDisplayError(e, t.error));
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  return (
    <section className={styles.section} aria-labelledby="settings-dev">
      <Eyebrow id="settings-dev">{t.title}</Eyebrow>
      <Card className={styles.group}>
        <p className={styles.hint}>{t.hint}</p>
        <Button
          variant="secondary"
          icon={<Database aria-hidden />}
          fullWidth
          onClick={() => {
            setConfirming(true);
          }}
        >
          {t.loadDemo}
        </Button>
        {status !== null && <p role="status">{status}</p>}
        {error !== null && (
          <div role="alert">
            <p>{error.message}</p>
            <ErrorDetails details={error.details} />
          </div>
        )}
      </Card>
      {confirming && (
        <ConfirmSheet
          title={t.confirmTitle}
          confirmLabel={t.confirm}
          confirmVariant="danger"
          busy={busy}
          onConfirm={() => void load()}
          onCancel={() => {
            setConfirming(false);
          }}
        >
          <p>{t.confirmText}</p>
        </ConfirmSheet>
      )}
    </section>
  );
}
