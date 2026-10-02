import { useEffect } from 'react';
import { HeartPulse } from 'lucide-react';
import { useParams, useSearchParams } from 'react-router';
import { Card, Eyebrow } from '../../components/Card';
import { EmptyState } from '../../components/EmptyState';
import { LoadingState } from '../../components/LoadingState';
import { Page } from '../../components/Page';
import { formatPerformance, getLastPerformance } from '../../domain/display';
import type { ProgramExercise, WorkoutSession } from '../../domain/types';
import { useActiveProgram, useWorkouts } from '../../hooks/useData';
import { strings } from '../../i18n/strings';
import { formatDayShort } from '../../utils/format';
import { StartWorkoutButton } from '../workout/WorkoutActions';
import { TargetSets } from '../workout/TargetSets';
import styles from './ProgramSessionPage.module.css';

const t = strings.program;

/** Détail d'une séance du programme : objectif, repos, dernière performance, notes (SPEC §7.3). */
export function ProgramSessionPage() {
  const { sessionId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const focusExerciseId = searchParams.get('exercise');
  const program = useActiveProgram();
  const workouts = useWorkouts();
  const session = program?.sessions.find((s) => s.id === sessionId);

  // Centre l'écran sur l'exercice touché dans la liste du programme.
  useEffect(() => {
    if (!session || !focusExerciseId) return;
    document.getElementById(`exercise-${focusExerciseId}`)?.scrollIntoView({ block: 'start' });
  }, [session, focusExerciseId]);

  if (program === undefined || workouts === undefined) {
    return (
      <Page title={t.title} backTo="/program" backLabel={t.title}>
        <LoadingState />
      </Page>
    );
  }

  if (!session) {
    return (
      <Page title={t.title} backTo="/program" backLabel={t.title}>
        <EmptyState icon={<HeartPulse />} title={strings.errors.notFoundTitle} text={t.sessionNotFound} />
      </Page>
    );
  }

  const exercises = [...session.exercises].sort((a, b) => a.order - b.order);
  return (
    <Page
      title={session.name}
      subtitle={[
        strings.common.exercises(exercises.length),
        session.estimatedDurationMin !== null ? `~${strings.common.minutes(session.estimatedDurationMin)}` : null,
      ]
        .filter(Boolean)
        .join(' · ')}
      backTo="/program"
      backLabel={t.title}
    >
      <StartWorkoutButton programSessionId={session.id} label={t.startThisSession} />

      {exercises.map((exercise, index) => (
        <ExerciseDetail key={exercise.id} exercise={exercise} index={index} workouts={workouts} highlighted={exercise.id === focusExerciseId} />
      ))}

      {session.cardio?.enabled && (
        <Card aria-labelledby="cardio-title">
          <h2 id="cardio-title" className={styles.exerciseName}>
            {session.cardio.label || t.cardio}
          </h2>
          {session.cardio.targetDurationMin !== null && (
            <p className={styles.meta}>{strings.workoutScreen.cardioTarget(session.cardio.targetDurationMin)}</p>
          )}
          {session.cardio.notes && <p className={styles.notes}>{session.cardio.notes}</p>}
        </Card>
      )}
    </Page>
  );
}

function ExerciseDetail({
  exercise,
  index,
  workouts,
  highlighted,
}: {
  exercise: ProgramExercise;
  index: number;
  workouts: WorkoutSession[];
  highlighted: boolean;
}) {
  const last = getLastPerformance(workouts, exercise.id);
  const headingId = `exercise-title-${exercise.id}`;
  return (
    <Card id={`exercise-${exercise.id}`} aria-labelledby={headingId} className={[styles.exerciseCard, highlighted && styles.highlighted].filter(Boolean).join(' ')}>
      <Eyebrow>{[`${index + 1}`, exercise.category, exercise.equipment].filter(Boolean).join(' · ')}</Eyebrow>
      <h2 id={headingId} className={styles.exerciseName}>
        {exercise.name}
      </h2>

      <div className={styles.blocks}>
        <TargetSets sets={exercise.sets} restSec={exercise.restSec} />

        <div>
          <Eyebrow>{t.lastTime}</Eyebrow>
          <p className={styles.lastTime}>
            {last ? (
              <>
                {formatPerformance(last.sets)} <span className={styles.meta}>· {formatDayShort(last.date)}</span>
              </>
            ) : (
              <span className={styles.meta}>{t.noPrevious}</span>
            )}
          </p>
        </div>

        {exercise.notes && (
          <div>
            <Eyebrow>{t.notes}</Eyebrow>
            <p className={styles.notes}>{exercise.notes}</p>
          </div>
        )}
      </div>
    </Card>
  );
}
