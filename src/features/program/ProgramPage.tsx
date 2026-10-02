import { ClipboardList } from 'lucide-react';
import { Card, Eyebrow } from '../../components/Card';
import { EmptyState } from '../../components/EmptyState';
import { LoadingState } from '../../components/LoadingState';
import { Page } from '../../components/Page';
import { useActiveProgram } from '../../hooks/useData';
import { strings } from '../../i18n/strings';
import { ImportProgramButton } from '../import/ImportProgramFlow';
import styles from './ProgramPage.module.css';

const t = strings.program;

/** Séances du programme actif, dans l'ordre du programme (SPEC §7.3). Détail et lancement au J3. */
export function ProgramPage() {
  const program = useActiveProgram();

  return (
    <Page title={t.title}>
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
                <div className={styles.sessionHeader}>
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
                </div>
                <ol className={styles.exercises}>
                  {[...session.exercises]
                    .sort((a, b) => a.order - b.order)
                    .map((exercise, index) => (
                      <li key={exercise.id} className={styles.exercise}>
                        <span className={styles.index}>{index + 1}</span>
                        <span className={styles.exerciseName}>{exercise.name}</span>
                        <span className={styles.exerciseMeta}>{exercise.equipment ?? exercise.category ?? ''}</span>
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
              </Card>
            ))}
        </>
      )}
    </Page>
  );
}
