import { ChevronLeft, ChevronRight, CircleCheck, HeartPulse, List, TriangleAlert } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router';
import { Badge } from '../../components/Badge';
import { Button, ButtonLink } from '../../components/Button';
import { Eyebrow } from '../../components/Card';
import { EmptyState } from '../../components/EmptyState';
import { ErrorDetails } from '../../components/ErrorDetails';
import { LoadingState } from '../../components/LoadingState';
import { ProgressBar } from '../../components/ProgressBar';
import { TextField } from '../../components/TextField';
import { formatPerformance, getLastPerformance } from '../../domain/display';
import type { WorkoutSession } from '../../domain/types';
import { countValidatedExercises, setComment, setSensation, validateExercise } from '../../domain/workout';
import { useProgram, useWorkout, useWorkouts } from '../../hooks/useData';
import { useWorkoutAutosave } from '../../hooks/useWorkoutAutosave';
import { strings } from '../../i18n/strings';
import { formatDayShort } from '../../utils/format';
import { TargetSets } from '../workout/TargetSets';
import { exercisePath, workoutPath } from '../workout/WorkoutActions';
import { ActualSets } from './ActualSets';
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

  const records = workout.exerciseRecords;
  const index = records.findIndex((r) => r.programExerciseId === exerciseId);
  const record = records[index];
  if (!record) return null;
  const previous = records[index - 1];
  const next = records[index + 1];
  const done = countValidatedExercises(workout);
  const last = getLastPerformance(workouts, exerciseId, workout.id);
  const listPath = workoutPath(workout.id);

  const validate = async () => {
    await autosave.flush();
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
        <h1 className={styles.name}>{record.exerciseName}</h1>
        {record.status === 'completed' && (
          <Badge tone="success">
            <CircleCheck aria-hidden />
            {strings.workoutScreen.statusDone}
          </Badge>
        )}
      </div>
      <ExerciseMeta workout={workout} exerciseId={exerciseId} />

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
          const normalized = text.trim() === '' ? '' : text;
          autosave.save(`${exerciseId}:comment`, record.comment ?? '', normalized, immediate, (w) => setComment(w, exerciseId, text));
        }}
      />

      {record.restSec !== null && <p className={styles.rest}>{t.restRecommended(record.restSec)}</p>}

      {/* Dans le flux de la page (jamais fixe) : reste accessible quand le clavier est ouvert. */}
      <div className={styles.validate}>
        <Button size="lg" fullWidth icon={<CircleCheck aria-hidden />} onClick={() => void validate()}>
          {t.validate}
        </Button>
        {record.status === 'completed' && <p className={styles.validatedNote}>{t.validated}</p>}
      </div>
    </div>
  );
}

/**
 * Catégorie et équipement (SPEC §7.4) : non copiés dans le snapshot du contrat,
 * ils sont lus dans le programme d'origine de la séance (toujours conservé, même archivé).
 */
function ExerciseMeta({ workout, exerciseId }: { workout: WorkoutSession; exerciseId: string }) {
  const program = useProgram(workout.programId);
  const exercise = program?.sessions.find((s) => s.id === workout.programSessionId)?.exercises.find((e) => e.id === exerciseId);
  const parts = [exercise?.category, exercise?.equipment].filter(Boolean);
  if (parts.length === 0) return null;
  return <p className={styles.meta}>{parts.join(' · ')}</p>;
}
