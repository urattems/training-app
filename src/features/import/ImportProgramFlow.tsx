import { createContext, use, useId, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { CircleCheck, ClipboardPaste, FileUp, TriangleAlert } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router';
import { Button, type ButtonVariant } from '../../components/Button';
import fieldStyles from '../../components/Field.module.css';
import { Sheet } from '../../components/Sheet';
import { useActiveProgram } from '../../hooks/useData';
import { strings } from '../../i18n/strings';
import type { ImportFailure } from '../../schemas/errors';
import { ignoredFieldNames } from '../../schemas/ignoredFields';
import { readFileText } from '../../services/importService';
import { sameWeekLabel, weekFolderName } from '../../domain/driveNames';
import { importProgram, listPrograms, previewPastedProgram, previewProgram, type ProgramPreview } from '../../services/programService';
import { canReadClipboard, readClipboardText } from '../../utils/clipboard';
import styles from './ImportProgramFlow.module.css';

/** Origine du programme : fichier choisi, ou texte collé (gardé en mémoire seulement, jamais en base). */
type Source = { kind: 'file' } | { kind: 'paste'; text: string };

type FlowState =
  | { step: 'idle' }
  | { step: 'reading' }
  | { step: 'paste'; text: string }
  | { step: 'preview'; preview: ProgramPreview; source: Source }
  | { step: 'importing'; preview: ProgramPreview; source: Source }
  | { step: 'error'; failure: ImportFailure; source: Source }
  | { step: 'done'; name: string };

interface ImportContextValue {
  pickFile: () => void;
  openPaste: () => void;
  reading: boolean;
}

const ImportContext = createContext<ImportContextValue | null>(null);

const t = strings.importFlow;

const FILE: Source = { kind: 'file' };

const unexpectedFailure = (error: unknown): ImportFailure => ({
  kind: 'invalid_schema',
  message: t.unexpected,
  details: [String(error)],
});

/**
 * Import de programme (SPEC §10.1) : fichier OU texte collé → validation → prévisualisation →
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
  const openPaste = (text = '') => {
    setShowDetails(false);
    setState({ step: 'paste', text });
  };
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
      setState({ step: 'error', failure: text.error, source: FILE });
      return;
    }
    const preview = previewProgram(text.value);
    setState(preview.ok ? { step: 'preview', preview: preview.value, source: FILE } : { step: 'error', failure: preview.error, source: FILE });
  };

  /** Texte collé : même pipeline que le fichier (parse, migration, Zod, invariants). Rien n'est écrit. */
  const verifyPasted = (text: string) => {
    setShowDetails(false);
    const source: Source = { kind: 'paste', text };
    const preview = previewPastedProgram(text);
    setState(preview.ok ? { step: 'preview', preview: preview.value, source } : { step: 'error', failure: preview.error, source });
  };

  const confirm = async (preview: ProgramPreview, source: Source) => {
    setState({ step: 'importing', preview, source });
    try {
      const result = await importProgram(preview.program);
      setState(result.ok ? { step: 'done', name: result.value.name } : { step: 'error', failure: result.error, source });
    } catch (error) {
      setState({ step: 'error', failure: unexpectedFailure(error), source });
    }
  };

  return (
    <ImportContext value={{ pickFile, openPaste, reading: state.step === 'reading' }}>
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

      {state.step === 'paste' && <PasteSheet initialText={state.text} onVerify={verifyPasted} onClose={close} />}

      {(state.step === 'preview' || state.step === 'importing') && (
        <Sheet
          title={t.previewTitle}
          icon={<FileUp aria-hidden />}
          onClose={close}
          dismissible={state.step === 'preview'}
          footer={
            <>
              <Button size="lg" fullWidth loading={state.step === 'importing'} onClick={() => void confirm(state.preview, state.source)}>
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
        <ErrorSheet
          failure={state.failure}
          source={state.source}
          showDetails={showDetails}
          onToggleDetails={() => {
            setShowDetails((v) => !v);
          }}
          onRetry={(source) => {
            if (source.kind === 'paste') {
              openPaste(source.text);
            } else {
              close();
              pickFile();
            }
          }}
          onClose={close}
        />
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

interface ErrorSheetProps {
  failure: ImportFailure;
  source: Source;
  showDetails: boolean;
  onToggleDetails: () => void;
  onRetry: (source: Source) => void;
  onClose: () => void;
}

/** Refus en bloc : message français, détails techniques à la demande, puis nouvel essai. */
function ErrorSheet({ failure, source, showDetails, onToggleDetails, onRetry, onClose }: ErrorSheetProps) {
  return (
    <Sheet
      title={source.kind === 'paste' ? t.textRefusedTitle : t.errorTitle}
      tone="danger"
      icon={<TriangleAlert aria-hidden />}
      onClose={onClose}
      footer={
        <>
          <Button
            size="lg"
            fullWidth
            onClick={() => {
              onRetry(source);
            }}
          >
            {source.kind === 'paste' ? t.editText : t.chooseAnother}
          </Button>
          <Button variant="ghost" fullWidth onClick={onClose}>
            {strings.common.close}
          </Button>
        </>
      }
    >
      <p role="alert">{failure.message}</p>
      {failure.details.length > 0 && (
        <div>
          <button type="button" className={styles.detailsToggle} aria-expanded={showDetails} onClick={onToggleDetails}>
            {showDetails ? t.hideDetails : t.showDetails}
          </button>
          {showDetails && (
            <ul className={styles.details}>
              {failure.details.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Sheet>
  );
}

/**
 * Zone de collage : le texte vit dans l'état React uniquement. Le bouton presse-papiers
 * n'est proposé que si l'API existe ; un refus renvoie, sans alarme, au collage manuel.
 */
function PasteSheet({ initialText, onVerify, onClose }: { initialText: string; onVerify: (text: string) => void; onClose: () => void }) {
  const [text, setText] = useState(initialText);
  const [manualHint, setManualHint] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const hintId = useId();
  const canRead = canReadClipboard();
  const showHint = manualHint || !canRead;

  const pasteFromClipboard = async () => {
    const pasted = await readClipboardText();
    if (pasted === null || pasted.trim() === '') {
      setManualHint(true);
      textareaRef.current?.focus();
      return;
    }
    setManualHint(false);
    setText(pasted);
  };

  return (
    <Sheet
      title={t.pasteTitle}
      icon={<ClipboardPaste aria-hidden />}
      onClose={onClose}
      footer={
        <>
          <Button
            size="lg"
            fullWidth
            disabled={text.trim() === ''}
            onClick={() => {
              onVerify(text);
            }}
          >
            {t.verify}
          </Button>
          <Button variant="ghost" fullWidth onClick={onClose}>
            {strings.common.cancel}
          </Button>
        </>
      }
    >
      <p className={styles.pasteIntro}>{t.pasteIntro}</p>
      {canRead && (
        <Button variant="secondary" fullWidth icon={<ClipboardPaste aria-hidden />} onClick={() => void pasteFromClipboard()}>
          {t.pasteFromClipboard}
        </Button>
      )}
      <textarea
        ref={textareaRef}
        className={`${fieldStyles.input ?? ''} ${fieldStyles.textarea ?? ''} ${styles.pasteArea ?? ''}`}
        aria-label={t.pasteLabel}
        aria-describedby={showHint ? hintId : undefined}
        value={text}
        rows={8}
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => {
          setText(e.target.value);
        }}
      />
      {showHint && (
        <p id={hintId} className={styles.pasteHint}>
          {t.pasteManually}
        </p>
      )}
    </Sheet>
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

/** Bouton qui ouvre la zone de collage (programme donné par le coach dans une conversation). */
export function ImportPasteButton({ variant = 'secondary', fullWidth = true }: { variant?: ButtonVariant; fullWidth?: boolean }) {
  const { openPaste } = useImportProgram();
  return (
    <Button variant={variant} fullWidth={fullWidth} icon={<ClipboardPaste aria-hidden />}
      onClick={() => {
        openPaste();
      }}
    >
      {t.pasteButton}
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
      <DuplicateWeekNote program={preview.program} />
      {ignored.length > 0 && <p className={styles.ignored}>{t.ignoredFields(ignored.join(', '))}</p>}
    </>
  );
}

/**
 * Archive Drive (V1.3) : alerte douce, non bloquante, si une semaine du même libellé existe déjà.
 * Le nom de dossier affiché est celui que l'archive utilisera (règle déterministe, spec §4).
 */
function DuplicateWeekNote({ program }: { program: ProgramPreview['program'] }) {
  const existing = useLiveQuery(listPrograms, []);
  if (!existing || sameWeekLabel(existing, program).length === 0) return null;
  const folder = weekFolderName([...existing, program], program.programId);
  return <p className={styles.note}>{strings.drive.duplicateWeek(program.week.label, folder)}</p>;
}
