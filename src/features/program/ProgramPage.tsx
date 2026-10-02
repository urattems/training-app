import { ChevronRight, ClipboardList, History } from 'lucide-react';
import { Link } from 'react-router';
import { Card, Eyebrow } from '../../components/Card';
import { EmptyState } from '../../components/EmptyState';
import { LoadingState } from '../../components/LoadingState';
import { IconLink, Page } from '../../components/Page';
import { useActiveProgram } from '../../hooks/useData';
import { strings } from '../../i18n/strings';
import { ImportProgramButton } from '../import/ImportProgramFlow';
import { StartWorkoutButton } from '../workout/WorkoutActions';
import { programSessionPath } from './paths';
import styles from './ProgramPage.module.css';

const t = strings.program;

/** Séances du programme actif, dans l'ordre du programme (SPEC §7.3). */
export function ProgramPage() {
  const program = useActiveProgram();

  return (
    <Page
      title={t.title}
      trailing={
        <IconLink to="/history" label={strings.history.link}>
          <History aria-hidden />
        </IconLink>
      }
    >
      {program === undefined && <LoadingState />}

      {program === null && (
        <EmptyState icon={<ClipboardList />} title={t.emptyTitle} text={t.emptyText}>
          <ImportProgramButton />
        </EmptyState>
      )}

      {program && (
        <>
          <div className={styles.programHeader}>
            <p className={styles.programName}>{program.name}</p>
            <p className={styles.meta}>{program.week.label}</p>
          </div>
          {[...program.sessions]
            .sort((a, b) => a.order - b.order)
            .map((session) => (
              <Card key={session.id} aria-labelledby={`session-${session.id}`}>
                <Link to={programSessionPath(session.id)} className={styles.sessionHeader}>
                  <span>
                    <h2 id={`session-${session.id}`} className={styles.sessionName}>
                      {session.name}
                    </h2>
                    <Eyebrow>
                      {[
                        strings.common.exercises(session.exercises.length),
                        session.estimatedDurationMin !== null ? strings.common.minutes(session.estimatedDurationMin) : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </Eyebrow>
                  </span>
                  <ChevronRight aria-hidden className={styles.chevron} />
                </Link>
                <ol className={styles.exercises}>
                  {[...session.exercises]
                    .sort((a, b) => a.order - b.order)
                    .map((exercise, index) => (
                      <li key={exercise.id}>
                        <Link to={programSessionPath(session.id, exercise.id)} className={styles.exercise}>
                          <span className={styles.index}>{index + 1}</span>
                          <span className={styles.exerciseName}>{exercise.name}</span>
                          <span className={styles.exerciseMeta}>{exercise.equipment ?? exercise.category ?? ''}</span>
                        </Link>
                      </li>
                    ))}
                </ol>
                {session.cardio?.enabled && (
                  <p className={styles.cardio}>
                    {session.cardio.targetDurationMin !== null
                      ? t.cardioDuration(session.cardio.targetDurationMin)
                      : session.cardio.label || t.cardio}
                  </p>
                )}
                <div className={styles.start}>
                  <StartWorkoutButton programSessionId={session.id} label={t.start} variant="secondary" size="md" />
                </div>
              </Card>
            ))}
        </>
      )}
    </Page>
  );
}
