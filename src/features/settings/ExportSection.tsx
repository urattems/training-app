import { useState } from 'react';
import { Download } from 'lucide-react';
import { Button } from '../../components/Button';
import { ErrorDetails } from '../../components/ErrorDetails';
import { useLastExportAt } from '../../hooks/useData';
import type { PreparedExportState } from '../../hooks/usePreparedExport';
import { strings } from '../../i18n/strings';
import { deliverPreparedExport, type DeliveryOutcome, type PreparedExport } from '../../services/exportService';
import { toDisplayError, type DisplayError } from '../../utils/errors';
import { formatDateTime } from '../../utils/format';
import styles from './SettingsPage.module.css';

const t = strings.export;

/**
 * Remet un export déjà préparé : `share` est appelé sans attente préalable, dans le geste.
 * Retourne l'issue, ou l'erreur affichable (dans ce cas `lastExportAt` n'est pas écrit).
 */
export async function deliverExport(prepared: PreparedExport): Promise<{ outcome: DeliveryOutcome } | { error: DisplayError }> {
  try {
    return { outcome: await deliverPreparedExport(prepared) };
  } catch (e) {
    console.error(e);
    return { error: toDisplayError(e, t.error) };
  }
}

/** « Exporter mes données » (SPEC §10.2). */
export function ExportSection({ state }: { state: PreparedExportState | undefined }) {
  const lastExportAt = useLastExportAt();
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<DisplayError | null>(null);
  const prepared = state?.ok ? state.prepared : null;
  // Erreur de remise, ou échec de préparation (ex. autotest d'intégrité).
  const shownError = error ?? (state && !state.ok ? state.error : null);

  const run = async () => {
    if (!prepared) return;
    setStatus(null);
    setError(null);
    const result = await deliverExport(prepared);
    if ('error' in result) setError(result.error);
    else if (result.outcome === 'shared') setStatus(t.shared);
    else if (result.outcome === 'downloaded') setStatus(t.downloaded(prepared.file.name));
  };

  return (
    <>
      {prepared && <p className={styles.hint}>{t.hint(prepared.programCount, prepared.sessionCount, prepared.weightCount)}</p>}
      <Button variant="primary" fullWidth icon={<Download aria-hidden />} loading={state === undefined} disabled={!prepared} onClick={() => void run()}>
        {state === undefined ? t.preparing : t.button}
      </Button>
      {lastExportAt !== undefined && (
        <p className={styles.meta}>
          {lastExportAt === null ? t.neverExported : t.lastExport(formatDateTime(lastExportAt))}
        </p>
      )}
      {status !== null && (
        <p role="status" className={styles.success}>
          {status}
        </p>
      )}
      {shownError !== null && (
        <div role="alert" className={styles.error}>
          <p>{shownError.message}</p>
          <ErrorDetails details={shownError.details} />
        </div>
      )}
    </>
  );
}
