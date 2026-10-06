import { useId, useRef } from 'react';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { NumberField } from '../../components/NumberField';
import { addExtraSet, applyAsPlanned, asPlannedValues, canFillAsPlanned, isRangeTarget, setActualValues } from '../../domain/workout';
import type { ActualSet, ProgramSet, WorkoutExercise } from '../../domain/types';
import { setRepsError, setWeightError } from '../../domain/values';
import type { WorkoutAutosave } from '../../hooks/useWorkoutAutosave';
import { strings } from '../../i18n/strings';
import { formatDecimal } from '../../utils/numbers';
import styles from './ActualSets.module.css';

const t = strings.exercise;

/** Garde-fous de saisie (V1.3.2) : message précis, dans le style du poids corporel. */
const repsCheck = (value: number): string | null => (setRepsError(value) === 'too_large' ? t.repsTooLarge : null);
const weightCheck = (value: number): string | null => {
  const error = setWeightError(value);
  return error === 'too_precise' ? t.weightTooPrecise : error === 'too_large' ? t.weightTooLarge : null;
};

/** Placeholder = objectif, en gris dans le champ vide. Jamais une valeur (SPEC §6). */
const repsPlaceholder = (target: ProgramSet | undefined): string =>
  target === undefined ? '' : isRangeTarget(target) ? `${target.targetRepsMin}–${target.targetRepsMax}` : String(target.targetReps);

const weightPlaceholder = (target: ProgramSet | undefined): string =>
  target?.targetWeightKg == null ? '' : formatDecimal(target.targetWeightKg);

/**
 * Bloc RÉALISÉ (SPEC §7.4) : une ligne par série [reps] [kg] + « Comme prévu »,
 * puis « + Série » en bas de liste uniquement. Champs vides au départ.
 * `plannedApplies` à `false` (exercice remplacé, V1.3.1) : le prévu ne s'applique plus au
 * réalisé, donc ni « Comme prévu » ni valeurs prévues en placeholder (jamais les valeurs de
 * l'exercice d'origine pour un autre exercice). Le nombre de lignes reste celui du programme.
 */
export function ActualSets({ record, autosave, plannedApplies = true }: { record: WorkoutExercise; autosave: WorkoutAutosave; plannedApplies?: boolean }) {
  const titleId = useId();
  const setNumbers = [...new Set([...record.targetSets, ...record.actualSets].map((s) => s.setNumber))].sort((a, b) => a - b);

  const addSet = async () => {
    await autosave.flush();
    await autosave.commit((w) => addExtraSet(w, record.programExerciseId));
  };

  return (
    <section className={styles.actual} aria-labelledby={titleId}>
      <h2 id={titleId} className={styles.title}>
        {t.actual}
      </h2>
      <ol className={styles.rows}>
        {setNumbers.map((setNumber) => (
          <li key={setNumber}>
            <SetRow
              exerciseId={record.programExerciseId}
              setNumber={setNumber}
              target={plannedApplies ? record.targetSets.find((s) => s.setNumber === setNumber) : undefined}
              actual={record.actualSets.find((s) => s.setNumber === setNumber)}
              autosave={autosave}
            />
          </li>
        ))}
      </ol>
      <Button variant="secondary" fullWidth onClick={() => void addSet()}>
        {t.addSet}
      </Button>
    </section>
  );
}

interface SetRowProps {
  exerciseId: string;
  setNumber: number;
  target: ProgramSet | undefined;
  actual: ActualSet | undefined;
  autosave: WorkoutAutosave;
}

function SetRow({ exerciseId, setNumber, target, actual, autosave }: SetRowProps) {
  const repsRef = useRef<HTMLInputElement>(null);
  const weightRef = useRef<HTMLInputElement>(null);
  const reps = actual?.actualReps ?? null;
  const weight = actual?.actualWeightKg ?? null;
  const isExtra = actual?.isExtra === true;

  const fillAsPlanned = async (prescribed: ProgramSet) => {
    const fill = asPlannedValues(prescribed);
    // Ligne partiellement remplissable : le focus passe au champ restant (geste explicite, fiable sur iOS).
    if (!('actualReps' in fill)) repsRef.current?.focus();
    else if (!('actualWeightKg' in fill)) weightRef.current?.focus();
    await autosave.flush();
    await autosave.commit((w) => applyAsPlanned(w, exerciseId, setNumber));
  };

  return (
    <div className={styles.row}>
      <div className={styles.rowHeader}>
        <span className={styles.setLabel}>
          {t.setLabel(setNumber)}
          {isExtra && <Badge tone="accent">{t.extraSet}</Badge>}
        </span>
        {target && canFillAsPlanned(target) && (
          <button type="button" className={styles.asPlanned} aria-label={t.asPlannedLabel(setNumber)} onClick={() => void fillAsPlanned(target)}>
            {t.asPlanned}
          </button>
        )}
      </div>
      <div className={styles.fields}>
        <NumberField
          ref={repsRef}
          label={t.repsLabel(setNumber)}
          mode="integer"
          unit={t.repsUnit}
          value={reps}
          placeholder={repsPlaceholder(target)}
          invalidMessage={t.invalidInteger}
          check={repsCheck}
          onInvalidInput={() => {
            autosave.cancel(`${exerciseId}:${setNumber}:reps`);
          }}
          onValueChange={(value, immediate) => {
            autosave.save(`${exerciseId}:${setNumber}:reps`, reps, value, immediate, (w) =>
              setActualValues(w, exerciseId, setNumber, { actualReps: value }),
            );
          }}
        />
        <NumberField
          ref={weightRef}
          label={t.weightLabel(setNumber)}
          mode="decimal"
          unit={t.weightUnit}
          value={weight}
          placeholder={weightPlaceholder(target)}
          invalidMessage={t.invalidNumber}
          check={weightCheck}
          onInvalidInput={() => {
            autosave.cancel(`${exerciseId}:${setNumber}:kg`);
          }}
          onValueChange={(value, immediate) => {
            autosave.save(`${exerciseId}:${setNumber}:kg`, weight, value, immediate, (w) =>
              setActualValues(w, exerciseId, setNumber, { actualWeightKg: value }),
            );
          }}
        />
      </div>
    </div>
  );
}
