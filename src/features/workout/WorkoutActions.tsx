import { useState } from 'react';
import { Play, TriangleAlert } from 'lucide-react';
import { useNavigate } from 'react-router';
import { Button, type ButtonVariant } from '../../components/Button';
import { ConfirmSheet } from '../../components/ConfirmSheet';
import { Sheet } from '../../components/Sheet';
import { ErrorDetails } from '../../components/ErrorDetails';
import type { WorkoutSession } from '../../domain/types';
import { strings } from '../../i18n/strings';
import { abandonWorkout, getInProgressWorkout, startWorkout } from '../../services/workoutService';
import { toDisplayError, type DisplayError } from '../../utils/errors';

const t = strings.workoutScreen;

export const toError = (error: unknown): DisplayError => {
  console.error(error);
  return toDisplayError(error, strings.errors.unexpected);
};

export const workoutPath = (workoutId: string): string => `/workout/${encodeURIComponent(workoutId)}`;

export const exercisePath = (workoutId: string, programExerciseId: string): string =>
  `${workoutPath(workoutId)}/exercise/${encodeURIComponent(programExerciseId)}`;

/** Feuille d'erreur : message lisible + « Afficher les détails » (nom et message techniques). */
export function ErrorSheet({ title, error, onClose }: { title: string; error: DisplayError; onClose: () => void }) {
  return (
    <Sheet
      title={title}
      tone="danger"
      icon={<TriangleAlert aria-hidden />}
      onClose={onClose}
      footer={
        <Button size="lg" fullWidth onClick={onClose}>
          {strings.common.close}
        </Button>
      }
    >
      <p role="alert">{error.message}</p>
      <ErrorDetails details={error.details} />
    </Sheet>
  );
}

interface StartWorkoutButtonProps {
  programSessionId: string;
  label?: string;
  variant?: ButtonVariant;
  size?: 'md' | 'lg';
  fullWidth?: boolean;
}

/**
 * Démarre une séance (snapshot des objectifs) puis ouvre l'écran séance.
 * Si une séance est déjà en cours : Reprendre / Abandonner d'abord (SPEC §6).
 */
export function StartWorkoutButton({ programSessionId, label = strings.home.startSession, variant = 'primary', size = 'lg', fullWidth = true }: StartWorkoutButtonProps) {
  const navigate = useNavigate();
  const [starting, setStarting] = useState(false);
  const [blockingWorkout, setBlockingWorkout] = useState<WorkoutSession | null>(null);
  const [error, setError] = useState<DisplayError | null>(null);

  const start = async () => {
    setStarting(true);
    try {
      // État lu au moment du tap (jamais un état de chargement) : un tap n'est jamais ignoré.
      const inProgress = await getInProgressWorkout();
      if (inProgress) {
        setBlockingWorkout(inProgress);
        return;
      }
      const workout = await startWorkout(programSessionId);
      void navigate(workoutPath(workout.id));
    } catch (e) {
      setError(toError(e));
    } finally {
      setStarting(false);
    }
  };

  return (
    <>
      <Button variant={variant} size={size} fullWidth={fullWidth} icon={<Play aria-hidden />} loading={starting} onClick={() => void start()}>
        {label}
      </Button>
      {blockingWorkout && (
        <Sheet
          title={t.alreadyInProgressTitle}
          icon={<TriangleAlert aria-hidden />}
          onClose={() => {
            setBlockingWorkout(null);
          }}
          footer={
            <>
              <Button size="lg" fullWidth onClick={() => void navigate(workoutPath(blockingWorkout.id))}>
                {strings.home.resume}
              </Button>
              <AbandonWorkoutButton
                workout={blockingWorkout}
                onAbandoned={() => {
                  setBlockingWorkout(null);
                }}
              />
            </>
          }
        >
          <p>{t.alreadyInProgressText(blockingWorkout.sessionName)}</p>
        </Sheet>
      )}
      {error !== null && (
        <ErrorSheet
          title={t.startError}
          error={error}
          onClose={() => {
            setError(null);
          }}
        />
      )}
    </>
  );
}

interface AbandonWorkoutButtonProps {
  workout: WorkoutSession;
  onAbandoned?: () => void;
  fullWidth?: boolean;
}

/** « Abandonner » avec confirmation : statut `abandoned`, données conservées. */
export function AbandonWorkoutButton({ workout, onAbandoned, fullWidth = true }: AbandonWorkoutButtonProps) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<DisplayError | null>(null);

  const confirm = async () => {
    setBusy(true);
    try {
      await abandonWorkout(workout.id);
      setConfirming(false);
      onAbandoned?.();
    } catch (e) {
      setConfirming(false);
      setError(toError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        variant="ghost"
        fullWidth={fullWidth}
        onClick={() => {
          setConfirming(true);
        }}
      >
        {t.abandon}
      </Button>
      {confirming && (
        <ConfirmSheet
          title={t.abandonTitle}
          confirmLabel={t.abandonConfirm}
          confirmVariant="danger"
          cancelLabel={t.keepGoing}
          busy={busy}
          onConfirm={() => void confirm()}
          onCancel={() => {
            setConfirming(false);
          }}
        >
          <p>{t.abandonText}</p>
        </ConfirmSheet>
      )}
      {error !== null && (
        <ErrorSheet
          title={t.actionError}
          error={error}
          onClose={() => {
            setError(null);
          }}
        />
      )}
    </>
  );
}
