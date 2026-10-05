import { useLayoutEffect, useState } from 'react';
import { Check, ChevronRight, CircleDashed, HeartPulse } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Card, Eyebrow } from '../../components/Card';
import { ConfirmSheet } from '../../components/ConfirmSheet';
import { EmptyState } from '../../components/EmptyState';
import { LoadingState } from '../../components/LoadingState';
import { Page } from '../../components/Page';
import { ProgressBar } from '../../components/ProgressBar';
import { workoutStatusLabel } from '../../domain/display';
import type { WorkoutExercise, WorkoutSession } from '../../domain/types';
import { countValidatedExercises } from '../../domain/workout';
import { useProgram, useWorkout } from '../../hooks/useData';
import { strings } from '../../i18n/strings';
import { finishWorkout } from '../../services/workoutService';
import { formatTime } from '../../utils/format';
import { resetScreen } from '../../utils/screen';
import { CardioSection } from './CardioSection';
import { AbandonWorkoutButton, ErrorSheet, exercisePath, toError } from './WorkoutActions';
import type { DisplayError } from '../../utils/errors';
import styles from './WorkoutPage.module.css';

const t = strings.workoutScreen;

/** Écran séance (SPEC §7.3b) : exercices et statut, accès libre, cardio, Terminer / Abandonner. */
export function WorkoutPage() {
  const { workoutId = '' } = useParams();
  const workout = useWorkout(workoutId);

  if (workout === undefined) {
    return (
      <Page title={strings.common.loading} backTo="/" backLabel={strings.nav.home}>
        <LoadingState />
      </Page>
    );
  }
  if (workout === null) {
    return (
      <Page title={strings.errors.notFoundTitle} backTo="/" backLabel={strings.nav.home}>
        <EmptyState icon={<HeartPulse />} title={strings.errors.notFoundTitle} text={t.notFound} />
      </Page>
    );
  }
  if (workout.status !== 'in_progress') {
    return (
      <Page title={workout.sessionName} backTo="/" backLabel={strings.nav.home}>
        <EmptyState icon={<Check />} title={t.notInProgressTitle(workoutStatusLabel(workout.status))} text={t.notInProgressText} />
      </Page>
    );
  }
  return <InProgressWorkout workout={workout} />;
}

function InProgressWorkout({ workout }: { workout: WorkoutSession }) {
  const navigate = useNavigate();
  const program = useProgram(workout.programId);
  const [confirmPending, setConfirmPending] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState<DisplayError | null>(null);

  // Retour à la Liste (depuis un exercice) : la liste s'ouvre tout en haut, clavier fermé.
  useLayoutEffect(() => {
    resetScreen();
  }, []);

  const done = countValidatedExercises(workout);
  const total = workout.exerciseRecords.length;
  const pending = total - done;
  const programCardio = program?.sessions.find((s) => s.id === workout.programSessionId)?.cardio ?? null;

  const finish = async () => {
    setFinishing(true);
    try {
      await finishWorkout(workout.id);
      void navigate('/', { replace: true });
    } catch (e) {
      setError(toError(e));
    } finally {
      setFinishing(false);
      setConfirmPending(false);
    }
  };

  return (
    <Page title={workout.sessionName} subtitle={strings.home.startedAt(formatTime(workout.startedAt))} backTo="/" backLabel={strings.nav.home}>
      <div className={styles.progressRow}>
        <ProgressBar value={done} max={total} label={t.progressLabel(done, total)} />
        <span className={styles.progressText}>{t.progress(done, total)}</span>
      </div>

      <Card aria-labelledby="exercises-title" className={styles.listCard}>
        <Eyebrow id="exercises-title">{t.exercisesTitle}</Eyebrow>
        <ol className={styles.list}>
          {workout.exerciseRecords.map((record, index) => (
            <li key={record.programExerciseId}>
              <ExerciseRow workoutId={workout.id} record={record} index={index} />
            </li>
          ))}
        </ol>
      </Card>

      <CardioSection workout={workout} programCardio={programCardio} />

      <div className={styles.footer}>
        <Button
          size="lg"
          fullWidth
          loading={finishing}
          onClick={() => {
            if (pending > 0) setConfirmPending(true);
            else void finish();
          }}
        >
          {finishing ? t.finishing : t.finish}
        </Button>
        <AbandonWorkoutButton
          workout={workout}
          onAbandoned={() => {
            void navigate('/', { replace: true });
          }}
        />
      </div>

      {error !== null && (
        <ErrorSheet
          title={t.actionError}
          error={error}
          onClose={() => {
            setError(null);
          }}
        />
      )}

      {confirmPending && (
        <ConfirmSheet
          title={t.pendingTitle(pending)}
          confirmLabel={t.finishAnyway}
          cancelLabel={t.keepGoing}
          busy={finishing}
          onConfirm={() => void finish()}
          onCancel={() => {
            setConfirmPending(false);
          }}
        >
          <p>{t.pendingText}</p>
        </ConfirmSheet>
      )}
    </Page>
  );
}

function ExerciseRow({ workoutId, record, index }: { workoutId: string; record: WorkoutExercise; index: number }) {
  // Séries prescrites saisies ; les séries en plus sont comptées à part.
  const hasValue = (s: WorkoutExercise['actualSets'][number]) => s.actualReps !== null || s.actualWeightKg !== null;
  const entered = record.actualSets.filter((s) => !s.isExtra && hasValue(s)).length;
  const extras = record.actualSets.filter((s) => s.isExtra && hasValue(s)).length;
  const validated = record.status === 'completed';
  return (
    <Link to={exercisePath(workoutId, record.programExerciseId)} className={styles.row}>
      <span className={validated ? styles.indexDone : styles.index} aria-hidden>
        {validated ? <Check /> : index + 1}
      </span>
      <span className={styles.rowText}>
        <span className={styles.rowName}>{record.exerciseName}</span>
        <span className={styles.rowMeta}>
          {t.setsEntered(entered, record.targetSets.length)}
          {extras > 0 && ` · ${t.extraSets(extras)}`}
        </span>
      </span>
      <Badge tone={validated ? 'success' : 'neutral'}>
        {validated ? <Check aria-hidden /> : <CircleDashed aria-hidden />}
        {validated ? t.statusDone : t.statusTodo}
      </Badge>
      <ChevronRight aria-hidden className={styles.chevron} />
    </Link>
  );
}
