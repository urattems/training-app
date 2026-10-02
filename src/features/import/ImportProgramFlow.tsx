import { createContext, use, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { CircleCheck, FileUp, TriangleAlert } from 'lucide-react';
import { useNavigate } from 'react-router';
import { Button, type ButtonVariant } from '../../components/Button';
import { Sheet } from '../../components/Sheet';
import { useActiveProgram } from '../../hooks/useData';
import { strings } from '../../i18n/strings';
import type { ImportFailure } from '../../schemas/errors';
import { ignoredFieldNames } from '../../schemas/ignoredFields';
import { readFileText } from '../../services/importService';
import { importProgram, previewProgram, type ProgramPreview } from '../../services/programService';
import styles from './ImportProgramFlow.module.css';

type FlowState =
  | { step: 'idle' }
  | { step: 'reading' }
  | { step: 'preview'; preview: ProgramPreview }
  | { step: 'importing'; preview: ProgramPreview }
  | { step: 'error'; failure: ImportFailure }
  | { step: 'done'; name: string };

interface ImportContextValue {
  pickFile: () => void;
  reading: boolean;
}

const ImportContext = createContext<ImportContextValue | null>(null);

const t = strings.importFlow;

const unexpectedFailure = (error: unknown): ImportFailure => ({
  kind: 'invalid_schema',
  message: t.unexpected,
  details: [String(error)],
});

/**
 * Import de programme (SPEC §10.1) : fichier → validation → prévisualisation →
 * Annuler / Importer. Rien n'est écrit avant la confirmation explicite.
 * L'état vit au niveau de l'app : les feuilles survivent au changement d'écran
 * provoqué par l'import (l'accueil passe de « Bienvenue » au programme actif).
 */
export function ImportProgramProvider({ children }: { children: ReactNode }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<FlowState>({ step: 'idle' });
  const [showDetails, setShowDetails] = useState(false);
  const activeProgram = useActiveProgram();
  const navigate = useNavigate();

  const pickFile = () => inputRef.current?.click();
  const close = () => {
    setState({ step: 'idle' });
    setShowDetails(false);
  };
  const finish = () => {
    close();
    void navigate('/');
  };

  const onFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Réinitialise le champ pour pouvoir re-choisir le même fichier.
    event.target.value = '';
    if (!file) return;
    setShowDetails(false);
    setState({ step: 'reading' });
    const text = await readFileText(file, 'program');
    if (!text.ok) {
      setState({ step: 'error', failure: text.error });
      return;
    }
    const preview = previewProgram(text.value);
    setState(preview.ok ? { step: 'preview', preview: preview.value } : { step: 'error', failure: preview.error });
  };

  const confirm = async (preview: ProgramPreview) => {
    setState({ step: 'importing', preview });
    try {
      const result = await importProgram(preview.program);
      setState(result.ok ? { step: 'done', name: result.value.name } : { step: 'error', failure: result.error });
    } catch (error) {
      setState({ step: 'error', failure: unexpectedFailure(error) });
    }
  };

  return (
    <ImportContext value={{ pickFile, reading: state.step === 'reading' }}>
      {children}
      <input
        ref={inputRef}
        type="file"
        accept=".json,application/json"
        className="visually-hidden"
        aria-label={t.choosingLabel}
        tabIndex={-1}
        onChange={(e) => void onFileChange(e)}
      />

      {(state.step === 'preview' || state.step === 'importing') && (
        <Sheet
          title={t.previewTitle}
          icon={<FileUp aria-hidden />}
          onClose={close}
          dismissible={state.step === 'preview'}
          footer={
            <>
              <Button size="lg" fullWidth loading={state.step === 'importing'} onClick={() => void confirm(state.preview)}>
                {state.step === 'importing' ? t.importing : t.confirm}
              </Button>
              <Button variant="ghost" fullWidth onClick={close} disabled={state.step === 'importing'}>
                {strings.common.cancel}
              </Button>
            </>
          }
        >
          <PreviewSummary preview={state.preview} activeProgramName={activeProgram?.name ?? null} />
        </Sheet>
      )}

      {state.step === 'error' && (
        <Sheet
          title={t.errorTitle}
          tone="danger"
          icon={<TriangleAlert aria-hidden />}
          onClose={close}
          footer={
            <>
              <Button
                size="lg"
                fullWidth
                onClick={() => {
                  close();
                  pickFile();
                }}
              >
                {t.chooseAnother}
              </Button>
              <Button variant="ghost" fullWidth onClick={close}>
                {strings.common.close}
              </Button>
            </>
          }
        >
          <p role="alert">{state.failure.message}</p>
          {state.failure.details.length > 0 && (
            <div>
              <button
                type="button"
                className={styles.detailsToggle}
                aria-expanded={showDetails}
                onClick={() => {
                  setShowDetails((v) => !v);
                }}
              >
                {showDetails ? t.hideDetails : t.showDetails}
              </button>
              {showDetails && (
                <ul className={styles.details}>
                  {state.failure.details.map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </Sheet>
      )}

      {state.step === 'done' && (
        <Sheet
          title={t.successTitle}
          tone="success"
          icon={<CircleCheck aria-hidden />}
          onClose={finish}
          footer={
            <Button size="lg" fullWidth onClick={finish}>
              {strings.common.continue}
            </Button>
          }
        >
          <p role="status">{t.successText(state.name)}</p>
        </Sheet>
      )}
    </ImportContext>
  );
}

function useImportProgram(): ImportContextValue {
  const context = use(ImportContext);
  if (!context) throw new Error('ImportProgramButton doit être placé dans ImportProgramProvider');
  return context;
}

interface ImportProgramButtonProps {
  label?: string;
  variant?: ButtonVariant;
  size?: 'md' | 'lg';
  fullWidth?: boolean;
}

/** Bouton qui ouvre le sélecteur de fichier programme. */
export function ImportProgramButton({ label = t.pickFile, variant = 'primary', size = 'md', fullWidth = true }: ImportProgramButtonProps) {
  const { pickFile, reading } = useImportProgram();
  return (
    <Button variant={variant} size={size} fullWidth={fullWidth} icon={<FileUp aria-hidden />} onClick={pickFile} loading={reading}>
      {reading ? t.reading : label}
    </Button>
  );
}

function PreviewSummary({ preview, activeProgramName }: { preview: ProgramPreview; activeProgramName: string | null }) {
  const ignored = ignoredFieldNames(preview.ignoredFields);
  return (
    <>
      <div className={styles.summary}>
        <p className={styles.programName}>{preview.name}</p>
        <dl className={styles.facts}>
          <div>
            <dt>{t.week}</dt>
            <dd>{preview.weekLabel}</dd>
          </div>
          <div>
            <dt>{t.sessions}</dt>
            <dd>{preview.sessionCount}</dd>
          </div>
          <div>
            <dt>{t.exercises}</dt>
            <dd>{preview.exerciseCount}</dd>
          </div>
        </dl>
      </div>
      {activeProgramName !== null && <p className={styles.note}>{t.willArchive(activeProgramName)}</p>}
      {ignored.length > 0 && <p className={styles.ignored}>{t.ignoredFields(ignored.join(', '))}</p>}
    </>
  );
}
