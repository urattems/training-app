import { useRef, useState, type ChangeEvent } from 'react';
import { CircleCheck, Download, RotateCcw, TriangleAlert } from 'lucide-react';
import { useNavigate } from 'react-router';
import { Button } from '../../components/Button';
import { ErrorDetails } from '../../components/ErrorDetails';
import { Sheet } from '../../components/Sheet';
import { measurementsLostByRestore } from '../../domain/measurements';
import { weightsLostByRestore } from '../../domain/weight';
import type { PreparedExportState } from '../../hooks/usePreparedExport';
import { strings } from '../../i18n/strings';
import { previewRestore, readFileText, restoreBackup, type RestorePreview } from '../../services/importService';
import { toDisplayError, type DisplayError } from '../../utils/errors';
import { formatDateTime } from '../../utils/format';
import { deliverExport } from './ExportSection';
import styles from './SettingsPage.module.css';

const t = strings.restore;

type FlowState =
  | { step: 'idle' }
  | { step: 'reading' }
  | { step: 'refused'; error: DisplayError }
  | { step: 'confirm'; preview: RestorePreview }
  | { step: 'restoring'; preview: RestorePreview }
  | { step: 'failed'; error: DisplayError }
  | { step: 'done'; programs: number; sessions: number };

/**
 * Restaurer une sauvegarde (SPEC §10.3) : fichier → validation (Zod + invariants §10.5)
 * → résumé → export obligatoire des données actuelles → « Restaurer » → transaction unique
 * (copie interne `preRestoreBackup` comprise). Tout fichier invalide est refusé en bloc.
 */
export function RestoreFlow({ currentExport }: { currentExport: PreparedExportState | undefined }) {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<FlowState>({ step: 'idle' });
  const [safetyExported, setSafetyExported] = useState(false);
  const [safetyError, setSafetyError] = useState<DisplayError | null>(null);

  const current = currentExport?.ok ? currentExport.prepared : null;
  // Rien à perdre si la base est vide (ex. nouvel iPhone) : l'export de sécurité n'est pas exigé.
  // Des pesées seules sont des données à sauvegarder (V1.2).
  // Des mensurations seules aussi (V1.5.0).
  const nothingToSave =
    current !== null && current.programCount === 0 && current.sessionCount === 0 && current.weightCount === 0 && current.measurementCount === 0;
  const canRestore = safetyExported || nothingToSave;

  const close = () => {
    setState({ step: 'idle' });
    setSafetyExported(false);
    setSafetyError(null);
  };

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setSafetyExported(false);
    setSafetyError(null);
    setState({ step: 'reading' });
    const text = await readFileText(file, 'history');
    if (!text.ok) {
      setState({ step: 'refused', error: { message: text.error.message, details: text.error.details } });
      return;
    }
    const preview = previewRestore(text.value);
    setState(
      preview.ok
        ? { step: 'confirm', preview: preview.value }
        : { step: 'refused', error: { message: preview.error.message, details: preview.error.details } },
    );
  };

  const exportCurrent = async () => {
    if (!current) return;
    setSafetyError(null);
    const result = await deliverExport(current);
    if ('error' in result) setSafetyError(result.error);
    else if (result.outcome !== 'cancelled') setSafetyExported(true);
  };

  const restore = async (preview: RestorePreview) => {
    setState({ step: 'restoring', preview });
    try {
      await restoreBackup(preview.data);
      setState({ step: 'done', programs: preview.programCount, sessions: preview.sessionCount });
    } catch (e) {
      console.error(e);
      setState({ step: 'failed', error: toDisplayError(e, t.error) });
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".json,application/json"
        className="visually-hidden"
        aria-label={t.choosingLabel}
        tabIndex={-1}
        onChange={(e) => void onFile(e)}
      />
      <p className={styles.hint}>{t.hint}</p>
      <Button
        variant="secondary"
        fullWidth
        icon={<RotateCcw aria-hidden />}
        loading={state.step === 'reading'}
        onClick={() => inputRef.current?.click()}
      >
        {state.step === 'reading' ? t.reading : t.button}
      </Button>

      {(state.step === 'refused' || state.step === 'failed') && (
        <Sheet
          title={state.step === 'refused' ? t.refusedTitle : t.errorTitle}
          tone="danger"
          icon={<TriangleAlert aria-hidden />}
          onClose={close}
          footer={
            <Button size="lg" fullWidth onClick={close}>
              {strings.common.close}
            </Button>
          }
        >
          <p role="alert">{state.error.message}</p>
          <ErrorDetails details={state.error.details} />
        </Sheet>
      )}

      {(state.step === 'confirm' || state.step === 'restoring') && (
        <Sheet
          title={t.previewTitle}
          icon={<RotateCcw aria-hidden />}
          onClose={close}
          dismissible={state.step === 'confirm'}
          footer={
            <>
              <Button size="lg" fullWidth disabled={!canRestore} loading={state.step === 'restoring'} onClick={() => void restore(state.preview)}>
                {state.step === 'restoring' ? t.restoring : t.restore}
              </Button>
              {!canRestore && <p className={styles.lockedHint}>{t.restoreLocked}</p>}
              <Button variant="ghost" fullWidth disabled={state.step === 'restoring'} onClick={close}>
                {strings.common.cancel}
              </Button>
            </>
          }
        >
          <dl className={styles.summary}>
            <div>
              <dt>{t.exportedAt}</dt>
              <dd>{formatDateTime(state.preview.exportedAt)}</dd>
            </div>
            <div>
              <dt>{t.schemaVersion}</dt>
              <dd>{state.preview.schemaVersion}</dd>
            </div>
            <div>
              <dt>{t.programs}</dt>
              <dd>{state.preview.programCount}</dd>
            </div>
            <div>
              <dt>{t.sessions}</dt>
              <dd>{state.preview.sessionCount}</dd>
            </div>
            <div>
              <dt>{t.weights}</dt>
              <dd>{state.preview.weightCount}</dd>
            </div>
            <div>
              <dt>{t.measurements}</dt>
              <dd>{state.preview.measurementCount}</dd>
            </div>
          </dl>
          <p className={styles.warning}>{t.warning}</p>
          {current !== null && <MissingWeightsWarning fileCount={state.preview.weightCount} currentCount={current.weightCount} />}
          {current !== null && <MissingMeasurementsWarning fileCount={state.preview.measurementCount} currentCount={current.measurementCount} />}

          <div className={styles.step}>
            <p className={styles.stepTitle}>{t.step1}</p>
            {nothingToSave ? (
              <p className={styles.meta}>{t.nothingToExport}</p>
            ) : safetyExported ? (
              <p role="status" className={styles.success}>
                <CircleCheck aria-hidden className={styles.inlineIcon} />
                {t.exportDone}
              </p>
            ) : (
              <Button variant="secondary" fullWidth icon={<Download aria-hidden />} loading={currentExport === undefined} disabled={!current} onClick={() => void exportCurrent()}>
                {t.exportCurrent}
              </Button>
            )}
            {safetyError !== null && (
              <div role="alert" className={styles.error}>
                <p>{safetyError.message}</p>
                <ErrorDetails details={safetyError.details} />
              </div>
            )}
          </div>
          <p className={styles.stepTitle}>{t.step2}</p>
        </Sheet>
      )}

      {state.step === 'done' && (
        <Sheet
          title={t.successTitle}
          tone="success"
          icon={<CircleCheck aria-hidden />}
          onClose={() => {
            close();
            void navigate('/');
          }}
          footer={
            <Button
              size="lg"
              fullWidth
              onClick={() => {
                close();
                void navigate('/');
              }}
            >
              {strings.common.continue}
            </Button>
          }
        >
          <p role="status">{t.successText(state.programs, state.sessions)}</p>
        </Sheet>
      )}
    </>
  );
}

/** Fichier sans pesée alors que l'app en contient : avertissement visible avant confirmation (V1.2). */
/** Même mécanisme que les pesées : un fichier sans mensurations remplacerait celles de l'app (V1.5.0). */
function MissingMeasurementsWarning({ fileCount, currentCount }: { fileCount: number; currentCount: number }) {
  const lost = measurementsLostByRestore(fileCount, currentCount);
  if (lost === null) return null;
  return (
    <p role="alert" className={styles.warning}>
      <TriangleAlert aria-hidden className={styles.inlineIcon} /> {t.noMeasurements(lost)}
    </p>
  );
}

function MissingWeightsWarning({ fileCount, currentCount }: { fileCount: number; currentCount: number }) {
  const lost = weightsLostByRestore(fileCount, currentCount);
  if (lost === null) return null;
  return (
    <p role="alert" className={styles.warning}>
      <TriangleAlert aria-hidden className={styles.inlineIcon} /> {t.noWeights(lost)}
    </p>
  );
}
