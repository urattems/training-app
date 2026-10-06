import { useId, useMemo, useState, type SyntheticEvent } from 'react';
import { Pencil } from 'lucide-react';
import { Button } from '../../components/Button';
import { scrollFieldIntoView } from '../../components/scrollFieldIntoView';
import { Sheet } from '../../components/Sheet';
import { isReplaced, resolveExerciseName, type HistoryRecord } from '../../domain/replacement';
import { useWorkouts } from '../../hooks/useData';
import type { WorkoutExercise } from '../../domain/types';
import { replaceExercise, restorePlannedExercise } from '../../domain/workout';
import type { WorkoutAutosave } from '../../hooks/useWorkoutAutosave';
import { strings } from '../../i18n/strings';
import fieldStyles from '../../components/Field.module.css';
import styles from './ReplaceExercise.module.css';

const t = strings.replace;

interface ReplaceExerciseButtonProps {
  /** Exercice de la séance (celui qu'on remplace). */
  record: WorkoutExercise;
  /** Tous les exercices de la séance : un nom déjà pris par un autre est refusé. */
  siblings: readonly WorkoutExercise[];
  /** Nom de l'exercice PRÉVU (programme d'origine), rappelé et non modifiable. */
  plannedName: string;
  autosave: WorkoutAutosave;
}

/**
 * Crayon « Remplacer cet exercice » et sa feuille (V1.3.1). Écran exercice d'une séance en cours
 * et mode « Modifier » du détail d'historique : mêmes règles, même feuille. L'écriture passe par
 * l'enregistrement automatique (mise à jour fonctionnelle de la séance), donc sauvegarde immédiate
 * et envois Drive comme pour toute modification de séance.
 */
export function ReplaceExerciseButton({ record, siblings, plannedName, autosave }: ReplaceExerciseButtonProps) {
  const [open, setOpen] = useState(false);
  const id = record.programExerciseId;
  // Historique : un nom long déjà utilisé garde son identifiant (continuité des courbes, V1.3.2).
  const workouts = useWorkouts();
  const history = useMemo(() => (workouts ?? []).flatMap((w) => w.exerciseRecords), [workouts]);

  /** Les saisies en attente partent d'abord : aucune perte, quel que soit le moment du tap. */
  const apply = async (update: Parameters<WorkoutAutosave['commit']>[0]) => {
    await autosave.flush();
    await autosave.commit(update);
  };

  return (
    <>
      <button
        type="button"
        className={styles.pencil}
        aria-label={t.edit}
        onClick={() => {
          setOpen(true);
        }}
      >
        <Pencil aria-hidden />
      </button>
      {open && (
        <ReplaceExerciseSheet
          record={record}
          others={siblings.filter((r) => r.programExerciseId !== id)}
          plannedName={plannedName}
          history={history}
          onSave={(name) => apply((w) => replaceExercise(w, id, name, plannedName, history))}
          onRestore={() => apply((w) => restorePlannedExercise(w, id, plannedName))}
          onClose={() => {
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

interface ReplaceExerciseSheetProps {
  record: WorkoutExercise;
  others: readonly WorkoutExercise[];
  history: readonly HistoryRecord[];
  plannedName: string;
  onSave: (name: string) => Promise<void>;
  onRestore: () => Promise<void>;
  onClose: () => void;
}

/** Feuille « Remplacer l'exercice » : prévu rappelé, champ « Exercice réalisé » prérempli et sélectionné au focus. */
function ReplaceExerciseSheet({ record, others, history, plannedName, onSave, onRestore, onClose }: ReplaceExerciseSheetProps) {
  const [text, setText] = useState(record.exerciseName);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputId = useId();
  const errorId = useId();
  const replaced = isReplaced(record);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    await action();
    onClose();
  };

  const submit = (event?: SyntheticEvent) => {
    event?.preventDefault();
    if (busy) return;
    const resolved = resolveExerciseName(text, { programExerciseId: record.programExerciseId, plannedName, others, history });
    if (!resolved.ok) {
      setError(resolved.message);
      return;
    }
    // Rien ne change : on referme sans écrire (ni remise en file Drive inutile).
    if (resolved.exerciseId === record.exerciseId && resolved.exerciseName === record.exerciseName) {
      onClose();
      return;
    }
    void run(() => onSave(text));
  };

  return (
    <Sheet
      title={t.title}
      icon={<Pencil aria-hidden />}
      onClose={onClose}
      dismissible={!busy}
      footer={
        <>
          <Button
            size="lg"
            fullWidth
            loading={busy}
            onClick={() => {
              submit();
            }}
          >
            {t.save}
          </Button>
          {replaced && (
            <Button variant="secondary" fullWidth disabled={busy} onClick={() => void run(onRestore)}>
              {t.restore}
            </Button>
          )}
          <Button variant="ghost" fullWidth disabled={busy} onClick={onClose}>
            {strings.common.cancel}
          </Button>
        </>
      }
    >
      <form className={styles.form} onSubmit={submit} noValidate>
        <p className={styles.planned}>{t.planned(plannedName)}</p>
        <div className={styles.field}>
          <label htmlFor={inputId} className={fieldStyles.label}>
            {t.fieldLabel}
          </label>
          <span className={fieldStyles.control}>
            <input
              id={inputId}
              className={fieldStyles.input}
              type="text"
              enterKeyHint="done"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              aria-invalid={error !== null || undefined}
              aria-describedby={error !== null ? errorId : undefined}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setError(null);
              }}
              onFocus={(e) => {
                // Le nom actuel est sélectionné : on peut le remplacer d'un geste, ou y ajouter « (autre machine) ».
                e.currentTarget.select();
                scrollFieldIntoView(e.currentTarget);
              }}
            />
          </span>
        </div>
        {error !== null && (
          <p id={errorId} role="alert" className={styles.error}>
            {error}
          </p>
        )}
        <p className={styles.scope}>{t.scope}</p>
      </form>
    </Sheet>
  );
}
