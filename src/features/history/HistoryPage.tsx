import { useEffect, useRef, useState } from 'react';
import { ChevronRight, History } from 'lucide-react';
import { Link } from 'react-router';
import { Badge, type BadgeTone } from '../../components/Badge';
import { Card } from '../../components/Card';
import { EmptyState } from '../../components/EmptyState';
import { LoadingState } from '../../components/LoadingState';
import { Page } from '../../components/Page';
import { workoutStatusLabel } from '../../domain/display';
import type { WorkoutSession, WorkoutStatus } from '../../domain/types';
import { useWorkouts } from '../../hooks/useData';
import { strings } from '../../i18n/strings';
import { formatDayLong, formatDuration } from '../../utils/format';
import { ErrorSheet, toError, workoutPath } from '../workout/WorkoutActions';
import type { DisplayError } from '../../utils/errors';
import { DeleteWorkoutSheet, removeWorkout } from './DeleteWorkoutSheet';
import { historyDetailPath } from './paths';
import { SwipeRow } from './SwipeRow';
import styles from './HistoryPage.module.css';

const t = strings.history;

export const STATUS_TONES: Record<WorkoutStatus, BadgeTone> = {
  completed: 'success',
  abandoned: 'warning',
  in_progress: 'accent',
};

/** Historique (SPEC §7.7) : ordre chronologique inverse — date, séance, statut, durée. */
export function HistoryPage() {
  const workouts = useWorkouts();
  const listRef = useRef<HTMLUListElement>(null);
  // Une seule ligne ouverte à la fois (balayage, V1.3.3).
  const [openId, setOpenId] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<WorkoutSession | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<DisplayError | null>(null);

  // Toucher ailleurs referme la ligne ouverte ; dans la liste, ce toucher ne fait rien d'autre (iOS).
  // L'indicateur est remis à zéro à chaque nouveau geste : un balayage (sans clic) ne laisse rien traîner.
  const openRef = useRef(openId);
  const swallowNextClick = useRef(false);
  useEffect(() => {
    openRef.current = openId;
  }, [openId]);
  useEffect(() => {
    const onPointerDown = (event: Event) => {
      swallowNextClick.current = false;
      const open = openRef.current;
      const target = event.target as Element | null;
      if (open === null || target?.closest(`[data-swipe-id="${CSS.escape(open)}"]`)) return;
      setOpenId(null);
      swallowNextClick.current = listRef.current?.contains(target) ?? false;
    };
    const onClick = (event: Event) => {
      if (swallowNextClick.current) {
        event.preventDefault();
        event.stopPropagation();
      }
      swallowNextClick.current = false;
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('click', onClick, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('click', onClick, true);
    };
  }, []);

  const confirmDelete = async (workout: WorkoutSession) => {
    setDeleting(true);
    try {
      await removeWorkout(workout);
      setOpenId(null);
      setToDelete(null);
    } catch (e) {
      setToDelete(null);
      setError(toError(e));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Page title={t.title} backTo="/" backLabel={strings.nav.home}>
      {workouts === undefined && <LoadingState />}
      {workouts?.length === 0 && <EmptyState icon={<History />} title={t.emptyTitle} text={t.emptyText} />}
      {workouts && workouts.length > 0 && (
        <Card className={styles.listCard}>
          <ul className={styles.list} ref={listRef}>
            {workouts.map((workout) => (
              <li key={workout.id} data-swipe-id={workout.id}>
                {workout.status === 'abandoned' ? (
                  // Seules les séances ABANDONNÉES se balayent (exception stricte à « aucune donnée perdue »).
                  <SwipeRow
                    open={openId === workout.id}
                    onOpenChange={(open) => {
                      setOpenId(open ? workout.id : null);
                    }}
                    actionText={t.swipeAction}
                    actionLabel={t.swipeActionLabel(workout.sessionName, formatDayLong(workout.date))}
                    onAction={() => {
                      setToDelete(workout);
                    }}
                  >
                    <HistoryRow workout={workout} />
                  </SwipeRow>
                ) : (
                  <HistoryRow workout={workout} />
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
      {toDelete !== null && (
        <DeleteWorkoutSheet
          workout={toDelete}
          busy={deleting}
          onConfirm={() => void confirmDelete(toDelete)}
          onCancel={() => {
            setToDelete(null);
          }}
        />
      )}
      {error !== null && (
        <ErrorSheet
          title={strings.workoutScreen.actionError}
          error={error}
          onClose={() => {
            setError(null);
          }}
        />
      )}
    </Page>
  );
}

function HistoryRow({ workout }: { workout: WorkoutSession }) {
  // Une séance en cours se reprend depuis l'écran séance.
  const to = workout.status === 'in_progress' ? workoutPath(workout.id) : historyDetailPath(workout.id);
  return (
    <Link to={to} className={styles.row}>
      <span className={styles.text}>
        <span className={styles.name}>{workout.sessionName}</span>
        <span className={styles.meta}>
          {[formatDayLong(workout.date), workout.durationSec !== null ? formatDuration(workout.durationSec) : null].filter(Boolean).join(' · ')}
        </span>
        {workout.status === 'in_progress' && <span className={styles.meta}>{t.inProgressHint}</span>}
      </span>
      <Badge tone={STATUS_TONES[workout.status]}>{workoutStatusLabel(workout.status)}</Badge>
      <ChevronRight aria-hidden className={styles.chevron} />
    </Link>
  );
}
