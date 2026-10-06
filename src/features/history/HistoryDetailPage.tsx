import { useId, useState } from 'react';
import { HeartPulse, Pencil, Play, Trash2 } from 'lucide-react';
import { useNavigate, useParams } from 'react-router';
import { Badge } from '../../components/Badge';
import { Button, ButtonLink } from '../../components/Button';
import { Card, Eyebrow } from '../../components/Card';
import { ConfirmSheet } from '../../components/ConfirmSheet';
import { EmptyState } from '../../components/EmptyState';
import { ErrorDetails } from '../../components/ErrorDetails';
import { LoadingState } from '../../components/LoadingState';
import { Page } from '../../components/Page';
import { TextField } from '../../components/TextField';
import { formatActualSet, workoutStatusLabel } from '../../domain/display';
import { isReplaced, plannedName as plannedNameOf } from '../../domain/replacement';
import type { WorkoutExercise, WorkoutSession } from '../../domain/types';
import { isValidLocalDate } from '../../domain/values';
import { setComment, setSensation, setWorkoutDate } from '../../domain/workout';
import { useProgram, useWorkout } from '../../hooks/useData';
import { useWorkoutAutosave, type WorkoutAutosave } from '../../hooks/useWorkoutAutosave';
import { strings } from '../../i18n/strings';
import { deleteWorkout } from '../../services/historyService';
import { formatDayLong, formatDuration, formatTime } from '../../utils/format';
import { formatDecimal } from '../../utils/numbers';
import { ActualSets } from '../exercise/ActualSets';
import { ReplaceExerciseButton } from '../exercise/ReplaceExercise';
import { SensationPicker } from '../exercise/SensationPicker';
import { TargetSets } from '../workout/TargetSets';
import { ErrorSheet, toError, workoutPath } from '../workout/WorkoutActions';
import type { DisplayError } from '../../utils/errors';
import { STATUS_TONES } from './HistoryPage';
import fieldStyles from '../../components/Field.module.css';
import styles from './HistoryDetailPage.module.css';

const t = strings.history;

/** Détail d'une séance (SPEC §7.7) : OBJECTIF puis RÉALISÉ, sensation, commentaire, cardio, ordre d'exécution. */
export function HistoryDetailPage() {
  const { workoutId = '' } = useParams();
  const workout = useWorkout(workoutId);

  if (workout === undefined) {
    return (
      <Page title={t.title} backTo="/history" backLabel={t.title}>
        <LoadingState />
      </Page>
    );
  }
  if (workout === null) {
    return (
      <Page title={strings.errors.notFoundTitle} backTo="/history" backLabel={t.title}>
        <EmptyState icon={<HeartPulse />} title={t.detailNotFound} />
      </Page>
    );
  }
  return <WorkoutDetail key={workout.id} workout={workout} />;
}

function WorkoutDetail({ workout }: { workout: WorkoutSession }) {
  const navigate = useNavigate();
  const autosave = useWorkoutAutosave(workout.id);
  // Programme d'origine (toujours conservé, même archivé) : nom de l'exercice PRÉVU d'un exercice remplacé.
  const program = useProgram(workout.programId);
  const programExercises = program?.sessions.find((s) => s.id === workout.programSessionId)?.exercises;
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<DisplayError | null>(null);
  const editable = workout.status !== 'in_progress';
  const isEditing = editable && editing;

  const remove = async () => {
    setDeleting(true);
    try {
      await autosave.flush();
      await deleteWorkout(workout.id);
      void navigate('/history', { replace: true });
    } catch (e) {
      setConfirmDelete(false);
      setError(toError(e));
    } finally {
      setDeleting(false);
    }
  };

  const nameOf = (id: string) => workout.exerciseRecords.find((r) => r.programExerciseId === id)?.exerciseName ?? id;

  return (
    <Page
      title={workout.sessionName}
      subtitle={<Badge tone={STATUS_TONES[workout.status]}>{workoutStatusLabel(workout.status)}</Badge>}
      backTo="/history"
      backLabel={t.title}
    >
      {workout.status === 'in_progress' && (
        <ButtonLink to={workoutPath(workout.id)} size="lg" fullWidth icon={<Play aria-hidden />}>
          {t.resume}
        </ButtonLink>
      )}

      {editable && (
        <div className={styles.editBar}>
          <Button
            variant={isEditing ? 'primary' : 'secondary'}
            fullWidth
            icon={isEditing ? undefined : <Pencil aria-hidden />}
            onClick={() => {
              if (isEditing) void autosave.flush();
              setEditing(!isEditing);
            }}
          >
            {isEditing ? t.doneEditing : t.edit}
          </Button>
          {isEditing && (
            <p className={styles.editHint} role="status">
              {autosave.savedAt !== null ? t.savedAt(formatTime(autosave.savedAt)) : t.editHint}
            </p>
          )}
          {autosave.error !== null && (
            <div role="alert" className={styles.error}>
              <p>{autosave.error.message}</p>
              <ErrorDetails details={autosave.error.details} />
            </div>
          )}
        </div>
      )}

      <Card>
        <dl className={styles.facts}>
          <div className={styles.fact}>
            <dt>{t.date}</dt>
            <dd>{isEditing ? <DateField workout={workout} autosave={autosave} /> : formatDayLong(workout.date)}</dd>
          </div>
          <div className={styles.fact}>
            <dt>{t.duration}</dt>
            <dd>
              {[t.startedAt(formatTime(workout.startedAt)), workout.durationSec !== null ? formatDuration(workout.durationSec) : null]
                .filter(Boolean)
                .join(' · ')}
            </dd>
          </div>
          <div className={styles.fact}>
            <dt>{t.executionOrder}</dt>
            <dd>
              {workout.executionOrder.length === 0 ? (
                <span className={styles.muted}>{t.noExecution}</span>
              ) : (
                <ol className={styles.order}>
                  {workout.executionOrder.map((id) => (
                    <li key={id}>{nameOf(id)}</li>
                  ))}
                </ol>
              )}
            </dd>
          </div>
        </dl>
      </Card>

      {workout.exerciseRecords.map((record) => (
        <ExerciseDetail
          key={record.programExerciseId}
          record={record}
          siblings={workout.exerciseRecords}
          planned={plannedNameOf(record, programExercises?.find((e) => e.id === record.programExerciseId)?.name)}
          editing={isEditing}
          autosave={autosave}
        />
      ))}

      <Card aria-labelledby="history-cardio-title">
        <Eyebrow id="history-cardio-title">{t.cardio}</Eyebrow>
        {workout.cardioRecords.length === 0 ? (
          <p className={styles.muted}>{t.noCardio}</p>
        ) : (
          <ul className={styles.plainList}>
            {workout.cardioRecords.map((entry, i) => (
              <li key={i}>
                <strong>{entry.name || strings.cardio.types[entry.type]}</strong>
                <span className={styles.muted}>
                  {[
                    entry.name ? strings.cardio.types[entry.type] : null,
                    entry.durationSec !== null ? formatDuration(entry.durationSec) : null,
                    entry.speedKmh !== null ? `${formatDecimal(entry.speedKmh)} km/h` : null,
                    entry.inclinePct !== null ? `${formatDecimal(entry.inclinePct)} %` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
                {entry.notes && <span className={styles.muted}>{entry.notes}</span>}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {workout.notes && (
        <Card>
          <Eyebrow>{t.notes}</Eyebrow>
          <p className={styles.notes}>{workout.notes}</p>
        </Card>
      )}

      <Button
        variant="danger"
        fullWidth
        icon={<Trash2 aria-hidden />}
        onClick={() => {
          setConfirmDelete(true);
        }}
      >
        {t.delete}
      </Button>

      {confirmDelete && (
        <ConfirmSheet
          title={t.deleteTitle}
          confirmLabel={t.deleteConfirm}
          confirmVariant="danger"
          busy={deleting}
          onConfirm={() => void remove()}
          onCancel={() => {
            setConfirmDelete(false);
          }}
        >
          <p>{t.deleteText(workout.sessionName, formatDayLong(workout.date))}</p>
        </ConfirmSheet>
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

/** Date de la séance (édition rétroactive) : sélecteur de date natif, persistance si valide. */
function DateField({ workout, autosave }: { workout: WorkoutSession; autosave: WorkoutAutosave }) {
  const [invalid, setInvalid] = useState(false);
  const errorId = useId();
  return (
    <>
      <input
        type="date"
        className={fieldStyles.input}
        aria-label={t.date}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? errorId : undefined}
        defaultValue={workout.date}
        onChange={(e) => {
          const value = e.target.value;
          if (!isValidLocalDate(value)) {
            setInvalid(true);
            return;
          }
          setInvalid(false);
          if (value !== workout.date) void autosave.commit((w) => setWorkoutDate(w, value));
        }}
      />
      {invalid && (
        <p id={errorId} className={fieldStyles.error} role="alert">
          {t.invalidDate}
        </p>
      )}
    </>
  );
}

interface ExerciseDetailProps {
  record: WorkoutExercise;
  siblings: readonly WorkoutExercise[];
  /** Nom de l'exercice prévu (`null` : le programme ne le connaît plus). */
  planned: string | null;
  editing: boolean;
  autosave: WorkoutAutosave;
}

function ExerciseDetail({ record, siblings, planned, editing, autosave }: ExerciseDetailProps) {
  const headingId = useId();
  const id = record.programExerciseId;
  const replaced = isReplaced(record);
  return (
    <Card aria-labelledby={headingId} className={styles.exercise}>
      <div className={styles.exerciseHeader}>
        <h2 id={headingId} className={styles.exerciseName}>
          {record.exerciseName}
        </h2>
        {/* Mode « Modifier » : mêmes règles et même feuille que sur l'écran exercice. */}
        {editing && planned !== null && <ReplaceExerciseButton record={record} siblings={siblings} plannedName={planned} autosave={autosave} />}
      </div>
      <div className={styles.badges}>
        {replaced && <Badge tone="accent">{strings.replace.badge}</Badge>}
        <Badge tone={record.status === 'completed' ? 'success' : 'neutral'}>{record.status === 'completed' ? t.validated : t.notValidated}</Badge>
      </div>

      <TargetSets sets={record.targetSets} restSec={record.restSec} plannedName={replaced && planned !== null ? planned : undefined} />

      {editing ? (
        <>
          <ActualSets record={record} autosave={autosave} plannedApplies={!replaced} />
          <SensationPicker
            value={record.sensation}
            onChange={(sensation) => {
              void autosave.commit((w) => setSensation(w, id, sensation));
            }}
          />
          <TextField
            label={strings.exercise.comment}
            visibleLabel
            multiline
            placeholder={strings.exercise.commentPlaceholder}
            value={record.comment ?? ''}
            onValueChange={(text, immediate) => {
              // Comparaison sur la valeur enregistrée (trim) : un espace final ne déclenche pas d'écriture.
              const normalized = text.trim();
              autosave.save(`${id}:comment`, record.comment ?? '', normalized, immediate, (v) => (w) => setComment(w, id, v));
            }}
          />
        </>
      ) : (
        <>
          <ActualSetsReadOnly record={record} />
          <p className={styles.sensation}>
            <span className={styles.label}>{strings.exercise.sensation} : </span>
            {record.sensation ? strings.sensations[record.sensation] : <span className={styles.muted}>{t.noSensation}</span>}
          </p>
          {record.comment && <p className={styles.comment}>« {record.comment} »</p>}
        </>
      )}
    </Card>
  );
}

/** RÉALISÉ en lecture : même habillage que l'éditeur (liseré d'accent), distinct de l'OBJECTIF. */
function ActualSetsReadOnly({ record }: { record: WorkoutExercise }) {
  return (
    <section className={styles.actual} aria-label={strings.exercise.actual}>
      <p className={styles.actualTitle}>{strings.exercise.actual}</p>
      {record.actualSets.length === 0 ? (
        <p className={styles.muted}>{t.noActual}</p>
      ) : (
        <ol className={styles.sets}>
          {record.actualSets.map((set) => {
            const notDone = set.actualReps === null && set.actualWeightKg === null;
            return (
              <li key={set.setNumber} className={styles.setRow}>
                <span>
                  {t.actualSet(set.setNumber)}
                  {set.isExtra && (
                    <>
                      {' '}
                      <Badge tone="accent">{t.extra}</Badge>
                    </>
                  )}
                </span>
                <span className={notDone ? styles.muted : styles.setValue}>{notDone ? t.notDone : formatActualSet(set)}</span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
