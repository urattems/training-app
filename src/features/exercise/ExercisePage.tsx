import { ChevronLeft, ChevronRight, CircleCheck, HeartPulse, List, TriangleAlert } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router';
import { useLayoutEffect, useRef, useState } from 'react';
import { Badge } from '../../components/Badge';
import { ConfirmSheet } from '../../components/ConfirmSheet';
import { Button, ButtonLink } from '../../components/Button';
import { Eyebrow } from '../../components/Card';
import { EmptyState } from '../../components/EmptyState';
import { ErrorDetails } from '../../components/ErrorDetails';
import { LoadingState } from '../../components/LoadingState';
import { ProgressBar } from '../../components/ProgressBar';
import { TextField } from '../../components/TextField';
import { formatPerformance, getLastPerformance } from '../../domain/display';
import type { ProgramExercise, WorkoutSession } from '../../domain/types';
import { countValidatedExercises, findIncompleteSets, setComment, setSensation, validateExercise, type IncompleteSets } from '../../domain/workout';
import { useProgram, useWorkout, useWorkouts } from '../../hooks/useData';
import { useWorkoutAutosave } from '../../hooks/useWorkoutAutosave';
import { getWorkout } from '../../services/workoutService';
import { strings } from '../../i18n/strings';
import { formatDayShort } from '../../utils/format';
import { resetScreen } from '../../utils/screen';
import { TargetSets } from '../workout/TargetSets';
import { exercisePath, workoutPath } from '../workout/WorkoutActions';
import { ActualSets } from './ActualSets';
import { ExerciseTip } from './ExerciseTip';
import { SensationPicker } from './SensationPicker';
import styles from './ExercisePage.module.css';

const t = strings.exercise;

/** Écran exercice (SPEC §7.4). La barre basse est masquée par le Shell sur cette route. */
export function ExercisePage() {
  const { workoutId = '', exerciseId = '' } = useParams();
  const workout = useWorkout(workoutId);
  const workouts = useWorkouts();

  if (workout === undefined || workouts === undefined) {
    return (
      <div className={styles.screen}>
        <LoadingState />
      </div>
    );
  }
  if (workout === null) {
    return <Message text={strings.workoutScreen.notFound} to="/" />;
  }
  if (workout.status !== 'in_progress') {
    return <Message text={t.notInProgress} to="/" />;
  }
  if (!workout.exerciseRecords.some((r) => r.programExerciseId === exerciseId)) {
    return <Message text={t.unknownExercise} to={workoutPath(workout.id)} />;
  }
  // Une clé par exercice : changer d'exercice démonte l'éditeur, ce qui écrit toute saisie en attente.
  return <ExerciseEditor key={exerciseId} workout={workout} exerciseId={exerciseId} workouts={workouts} />;
}

/** Écran d'erreur avec son propre titre principal (h1), comme tout écran. */
function Message({ text, to }: { text: string; to: string }) {
  return (
    <div className={styles.screen}>
      <h1 className={styles.name}>{strings.errors.notFoundTitle}</h1>
      <EmptyState icon={<HeartPulse />} title={text}>
        <ButtonLink to={to} variant="secondary" fullWidth>
          {strings.errors.backHome}
        </ButtonLink>
      </EmptyState>
    </div>
  );
}

function ExerciseEditor({ workout, exerciseId, workouts }: { workout: WorkoutSession; exerciseId: string; workouts: WorkoutSession[] }) {
  const navigate = useNavigate();
  const autosave = useWorkoutAutosave(workout.id);
  const [incomplete, setIncomplete] = useState<IncompleteSets | null>(null);
  const programExercise = useProgramExercise(workout, exerciseId);
  const titleRef = useRef<HTMLHeadingElement>(null);

  // Un éditeur par exercice (`key` ci-dessus) : ce montage est exactement un changement d'exercice
  // (Valider puis suivant, ← →, Liste, ouverture depuis l'écran séance, changement d'URL).
  // Jamais rejoué par une saisie, une série en plus, « Comme prévu » ou un enregistrement.
  useLayoutEffect(() => {
    resetScreen(titleRef.current);
  }, []);

  /** « Compléter » : ferme l'avertissement et place le curseur sur le premier champ manquant. */
  const completeMissing = (sets: IncompleteSets) => {
    const firstReps = sets.missingReps[0];
    const label = firstReps !== undefined ? t.repsLabel(firstReps) : t.weightLabel(sets.missingWeight[0] ?? 1);
    // Focus synchrone, dans le geste : le clavier s'ouvre sur iOS.
    document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)?.focus();
    setIncomplete(null);
  };

  const records = workout.exerciseRecords;
  const index = records.findIndex((r) => r.programExerciseId === exerciseId);
  const record = records[index];
  if (!record) return null;
  const previous = records[index - 1];
  const next = records[index + 1];
  const done = countValidatedExercises(workout);
  const last = getLastPerformance(workouts, exerciseId, workout.id);
  const listPath = workoutPath(workout.id);

  const validate = async (force = false) => {
    await autosave.flush();
    if (!force) {
      // Avertissement non bloquant : séries prescrites à moitié remplies (rien n'est inventé).
      const saved = (await getWorkout(workout.id))?.exerciseRecords.find((r) => r.programExerciseId === exerciseId);
      const incomplete = saved ? findIncompleteSets(saved) : null;
      if (incomplete && incomplete.missingReps.length + incomplete.missingWeight.length > 0) {
        setIncomplete(incomplete);
        return;
      }
    }
    setIncomplete(null);
    await autosave.commit((w) => validateExercise(w, exerciseId));
    // Passage direct à l'exercice suivant ; après le dernier, retour à l'écran séance (cardio, Terminer).
    void navigate(next ? exercisePath(workout.id, next.programExerciseId) : listPath, { replace: true });
  };

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <nav className={styles.nav} aria-label={t.position(index + 1, records.length)}>
          {previous ? (
            <Link to={exercisePath(workout.id, previous.programExerciseId)} replace className={styles.navButton} aria-label={t.previous}>
              <ChevronLeft aria-hidden />
            </Link>
          ) : (
            <span className={styles.navButton} aria-hidden />
          )}
          <span className={styles.position}>{t.position(index + 1, records.length)}</span>
          {next ? (
            <Link to={exercisePath(workout.id, next.programExerciseId)} replace className={styles.navButton} aria-label={t.next}>
              <ChevronRight aria-hidden />
            </Link>
          ) : (
            <span className={styles.navButton} aria-hidden />
          )}
          <Link to={listPath} className={styles.listButton} aria-label={t.listLabel}>
            <List aria-hidden />
            <span>{t.list}</span>
          </Link>
        </nav>
        <div className={styles.progressRow}>
          <ProgressBar value={done} max={records.length} label={strings.workoutScreen.progressLabel(done, records.length)} />
          <span className={styles.progressText}>{strings.workoutScreen.progress(done, records.length)}</span>
        </div>
      </header>

      <div className={styles.titleBlock}>
        <h1 ref={titleRef} tabIndex={-1} className={styles.name}>
          {record.exerciseName}
        </h1>
        {record.status === 'completed' && (
          <Badge tone="success">
            <CircleCheck aria-hidden />
            {strings.workoutScreen.statusDone}
          </Badge>
        )}
      </div>
      <ExerciseMeta exercise={programExercise} />

      {autosave.error !== null && (
        <div className={styles.saveError} role="alert">
          <div className={styles.saveErrorRow}>
            <TriangleAlert aria-hidden />
            <span>{autosave.error.message}</span>
            <button type="button" onClick={autosave.clearError}>
              {strings.common.close}
            </button>
          </div>
          <ErrorDetails details={autosave.error.details} />
        </div>
      )}

      <section className={styles.lastTime} aria-label={strings.program.lastTime}>
        <Eyebrow>{strings.program.lastTime}</Eyebrow>
        <p>
          {last ? (
            <>
              {formatPerformance(last.sets)} <span className={styles.muted}>· {formatDayShort(last.date)}</span>
            </>
          ) : (
            <span className={styles.muted}>{strings.program.noPrevious}</span>
          )}
        </p>
      </section>

      <ExerciseTip notes={programExercise?.notes} />

      <TargetSets sets={record.targetSets} />

      <ActualSets record={record} autosave={autosave} />

      <SensationPicker
        value={record.sensation}
        onChange={(sensation) => {
          void autosave.commit((w) => setSensation(w, exerciseId, sensation));
        }}
      />

      <TextField
        label={t.comment}
        visibleLabel
        multiline
        placeholder={t.commentPlaceholder}
        value={record.comment ?? ''}
        onValueChange={(text, immediate) => {
          // Comparaison sur la valeur enregistrée (trim) : un espace final ne déclenche pas d'écriture.
          const normalized = text.trim();
          autosave.save(`${exerciseId}:comment`, record.comment ?? '', normalized, immediate, (w) => setComment(w, exerciseId, text));
        }}
      />

      {record.restSec !== null && <p className={styles.rest}>{t.restRecommended(record.restSec)}</p>}

      {/* Dans le flux de la page (jamais fixe) : reste accessible quand le clavier est ouvert. */}
      <div className={styles.validate}>
        <Button size="lg" fullWidth icon={<CircleCheck aria-hidden />} onClick={() => void validate()}>
          {t.validate}
        </Button>
        {incomplete && (
          <ConfirmSheet
            title={t.incompleteTitle(incomplete.missingReps.length, incomplete.missingWeight.length)}
            confirmLabel={t.validateAnyway}
            cancelLabel={t.complete}
            onConfirm={() => void validate(true)}
            onCancel={() => {
              completeMissing(incomplete);
            }}
          >
            <p>{t.incompleteText}</p>
          </ConfirmSheet>
        )}
        {record.status === 'completed' && <p className={styles.validatedNote}>{t.validated}</p>}
      </div>
    </div>
  );
}

/**
 * Exercice du programme d'origine de la séance (toujours conservé, même archivé) :
 * catégorie, équipement et conseil (`notes`) ne sont pas copiés dans le snapshot du contrat.
 */
function useProgramExercise(workout: WorkoutSession, exerciseId: string): ProgramExercise | undefined {
  const program = useProgram(workout.programId);
  return program?.sessions.find((s) => s.id === workout.programSessionId)?.exercises.find((e) => e.id === exerciseId);
}

/** Catégorie et équipement (SPEC §7.4). */
function ExerciseMeta({ exercise }: { exercise: ProgramExercise | undefined }) {
  const parts = [exercise?.category, exercise?.equipment].filter(Boolean);
  if (parts.length === 0) return null;
  return <p className={styles.meta}>{parts.join(' · ')}</p>;
}
