import { Dumbbell, Settings } from 'lucide-react';
import { Link } from 'react-router';
import { Badge } from '../../components/Badge';
import { ButtonLink } from '../../components/Button';
import { Card, Eyebrow } from '../../components/Card';
import { EmptyState } from '../../components/EmptyState';
import { LoadingState } from '../../components/LoadingState';
import { IconLink, Page } from '../../components/Page';
import { ProgressBar } from '../../components/ProgressBar';
import { workoutStatusLabel } from '../../domain/display';
import { getExportReminder } from '../../domain/exportReminder';
import { formatSignedKg } from '../../domain/stats';
import type { WorkoutSession } from '../../domain/types';
import { countValidatedExercises } from '../../domain/workout';
import { useLiveQuery } from 'dexie-react-hooks';
import { DriveRegressionNotice } from '../settings/DriveRegressionNotice';
import { getLastAutoBackupAt, latestInstant } from '../../services/settingsService';
import { sessionDriveStatus, useDriveState, type SessionDriveStatus } from '../../hooks/useDrive';
import { useActiveProgram, useInProgressWorkout, useLastExportAt, useMeasurements, useNextSession, useRecentProgress, useWeights, useWorkouts } from '../../hooks/useData';
import { strings } from '../../i18n/strings';
import { formatDayLong, formatDuration, formatTime } from '../../utils/format';
import { historyDetailPath } from '../history/paths';
import { ImportPasteButton, ImportProgramButton } from '../import/ImportProgramFlow';
import { AbandonWorkoutButton, StartWorkoutButton, workoutPath } from '../workout/WorkoutActions';
import { useToday } from '../../hooks/useToday';
import { ActivityCard } from './ActivityCard';
import styles from './HomePage.module.css';

const t = strings.home;

/** Accueil : « Qu'est-ce que je dois faire aujourd'hui ? » (SPEC §7.2). */
export function HomePage() {
  const program = useActiveProgram();
  const inProgress = useInProgressWorkout();
  const nextSession = useNextSession();
  const workouts = useWorkouts();

  const loading = program === undefined || inProgress === undefined || nextSession === undefined || workouts === undefined;
  const lastWorkout = workouts?.find((w) => w.status !== 'in_progress') ?? null;

  return (
    <Page
      title={t.title}
      trailing={
        <IconLink to="/settings" label={strings.nav.settings}>
          <Settings aria-hidden />
        </IconLink>
      }
    >
      {loading && <LoadingState />}

      {!loading && program === null && !inProgress && (
        <EmptyState icon={<Dumbbell />} title={t.welcomeTitle} text={t.welcomeText}>
          <ImportProgramButton size="lg" />
          <ImportPasteButton />
          <p className={styles.hint}>{t.installHint}</p>
        </EmptyState>
      )}

      {!loading && inProgress && <InProgressCard workout={inProgress} />}

      {!loading && !inProgress && program && nextSession && (
        <Card aria-labelledby="next-session-title">
          <Eyebrow>{t.nextSession}</Eyebrow>
          <h2 id="next-session-title" className={styles.sessionName}>
            {nextSession.name}
          </h2>
          <p className={styles.meta}>
            {[
              strings.common.exercises(nextSession.exercises.length),
              nextSession.estimatedDurationMin !== null ? `~${strings.common.minutes(nextSession.estimatedDurationMin)}` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
          <div className={styles.actions}>
            <StartWorkoutButton programSessionId={nextSession.id} />
            <Link to="/program" className={styles.secondaryLink}>
              {t.chooseAnother}
            </Link>
          </div>
        </Card>
      )}

      {!loading && <ExportReminderBanner workouts={workouts} />}

      {!loading && <DriveChip />}

      {!loading && lastWorkout && <LastWorkoutCard workout={lastWorkout} />}

      {!loading && <Activity workouts={workouts} />}

      {!loading && <RecentProgress />}
    </Page>
  );
}

/**
 * Activité (V1.4.0) : carte SECONDAIRE, après la dernière séance. Masquée tant qu'aucune séance
 * n'a jamais été terminée (rien d'alarmant pour un débutant). Mise à jour par la même lecture
 * réactive que le reste de l'accueil.
 */
function Activity({ workouts }: { workouts: WorkoutSession[] }) {
  const today = useToday();
  if (!workouts.some((w) => w.status === 'completed')) return null;
  return <ActivityCard workouts={workouts} today={today} />;
}

function InProgressCard({ workout }: { workout: WorkoutSession }) {
  const done = countValidatedExercises(workout);
  const total = workout.exerciseRecords.length;
  return (
    <Card aria-labelledby="in-progress-title" className={styles.inProgress}>
      <Eyebrow>{t.startedAt(formatTime(workout.startedAt))}</Eyebrow>
      <h2 id="in-progress-title" className={styles.sessionName}>
        {t.inProgress(workout.sessionName)}
      </h2>
      <div className={styles.progressRow}>
        <ProgressBar value={done} max={total} label={strings.workoutScreen.progressLabel(done, total)} />
        <span className={styles.progressText}>{strings.workoutScreen.progress(done, total)}</span>
      </div>
      <div className={styles.actions}>
        <ButtonLink to={workoutPath(workout.id)} size="lg" fullWidth>
          {t.resume}
        </ButtonLink>
        <AbandonWorkoutButton workout={workout} />
      </div>
    </Card>
  );
}

/** « Dernière séance » : toute la carte mène au détail ; lien vers l'historique complet. */
function LastWorkoutCard({ workout }: { workout: WorkoutSession }) {
  return (
    <Card aria-labelledby="last-session-title">
      <Link to={historyDetailPath(workout.id)} className={styles.cardLink}>
        <div className={styles.rowBetween}>
          <Eyebrow>{t.lastSession}</Eyebrow>
          <Badge tone={workout.status === 'completed' ? 'success' : 'warning'}>{workoutStatusLabel(workout.status)}</Badge>
        </div>
        <h2 id="last-session-title" className={styles.lastName}>
          {workout.sessionName}
        </h2>
        <p className={styles.meta}>
          {[formatDayLong(workout.date), workout.durationSec !== null ? formatDuration(workout.durationSec) : null].filter(Boolean).join(' · ')}
        </p>
      </Link>
      <DriveSessionLine sessionId={workout.id} />
      <Link to="/history" className={styles.secondaryLink}>
        {strings.history.seeAll}
      </Link>
    </Card>
  );
}

/**
 * Rappel d'export (SPEC §7.10) : bandeau discret, ton neutre, jamais pendant une séance
 * en cours. Protection principale contre une purge éventuelle des données par Safari.
 */
function ExportReminderBanner({ workouts }: { workouts: WorkoutSession[] }) {
  const lastExportAt = useLastExportAt();
  const lastAutoBackupAt = useLiveQuery(getLastAutoBackupAt, []);
  const weights = useWeights();
  const measurements = useMeasurements();
  if (lastExportAt === undefined || lastAutoBackupAt === undefined || weights === undefined || measurements === undefined) return null;
  // Une pesée enregistrée après le dernier export est aussi une donnée non sauvegardée (V1.2).
  // V1.3b : une sauvegarde Drive CONFIRMÉE compte comme export (le plus récent des deux).
  const reminder = getExportReminder(workouts, latestInstant(lastExportAt, lastAutoBackupAt), new Date(), weights, measurements);
  if (!reminder) return null;
  return (
    <div className={styles.reminder} role="note">
      <p>{reminder.daysSinceExport === null ? strings.reminder.never : strings.reminder.days(reminder.daysSinceExport)}</p>
      <Link to="/settings" className={styles.reminderLink}>
        {strings.reminder.action}
      </Link>
    </div>
  );
}

function RecentProgress() {
  const progress = useRecentProgress();
  if (!progress || progress.length === 0) return null;
  return (
    <Card aria-labelledby="recent-progress-title">
      <Eyebrow id="recent-progress-title">{t.recentProgress}</Eyebrow>
      <ul className={styles.progressList}>
        {progress.map((p) => (
          <li key={p.programExerciseId}>
            <span>{p.exerciseName}</span>
            <span className={p.deltaKg > 0 ? styles.deltaUp : styles.deltaDown}>{formatSignedKg(p.deltaKg)}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

const DRIVE_LINES: Record<SessionDriveStatus, string> = {
  sending: strings.drive.lineSending,
  sent: strings.drive.lineSent,
  waiting: strings.drive.lineWaiting,
  error: strings.drive.lineError,
};

/**
 * Archive Drive : ligne discrète sous la dernière séance (l'app revient ici après « Terminer » ;
 * il n'existe pas d'écran de fin de séance distinct). Aucune action requise.
 */
function DriveSessionLine({ sessionId }: { sessionId: string }) {
  const drive = useDriveState();
  const status = drive ? sessionDriveStatus(drive, sessionId) : null;
  if (status === null) return null;
  return (
    <p role="status" className={styles.driveLine}>
      {DRIVE_LINES[status]}
    </p>
  );
}

/**
 * Archive Drive sur l'accueil : écran de choix si la sauvegarde est en pause (refus de régression),
 * sinon une puce discrète, seulement si des envois attendent (ou sont en erreur) depuis plus d'une heure.
 */
function DriveChip() {
  const drive = useDriveState();
  if (drive?.active && drive.outbox.regression) return <DriveRegressionNotice regression={drive.outbox.regression} />;
  if (!drive?.active || drive.summary.stalled === 0) return null;
  return (
    <Link to="/settings/drive" className={styles.driveChip}>
      {strings.drive.chip(drive.summary.pending + drive.summary.errors)}
    </Link>
  );
}
