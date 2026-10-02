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
import { workoutPath } from '../workout/WorkoutActions';
import { historyDetailPath } from './paths';
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
  return (
    <Page title={t.title} backTo="/" backLabel={strings.nav.home}>
      {workouts === undefined && <LoadingState />}
      {workouts?.length === 0 && <EmptyState icon={<History />} title={t.emptyTitle} text={t.emptyText} />}
      {workouts && workouts.length > 0 && (
        <Card className={styles.listCard}>
          <ul className={styles.list}>
            {workouts.map((workout) => (
              <li key={workout.id}>
                <HistoryRow workout={workout} />
              </li>
            ))}
          </ul>
        </Card>
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
