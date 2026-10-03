import { useState, type ReactNode } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '../../components/Button';
import { Card, Eyebrow } from '../../components/Card';
import { ConfirmSheet } from '../../components/ConfirmSheet';
import { ErrorDetails } from '../../components/ErrorDetails';
import { NumberField } from '../../components/NumberField';
import { TextField } from '../../components/TextField';
import type { CardioEntry, CardioType, ProgramCardio, WorkoutSession } from '../../domain/types';
import { addCardioEntry, normalizeText, removeCardioEntry, updateCardioEntry } from '../../domain/workout';
import { useWorkoutAutosave, type WorkoutAutosave } from '../../hooks/useWorkoutAutosave';
import { strings } from '../../i18n/strings';
import { CARDIO_TYPES } from '../../schemas/history.schema';
import styles from './CardioSection.module.css';

const t = strings.cardio;

/** Durée saisie en minutes (décimales acceptées), stockée en secondes entières (SPEC §7.6). */
const secondsToMinutes = (sec: number | null): number | null => (sec === null ? null : Math.round((sec / 60) * 100) / 100);
const minutesToSeconds = (min: number | null): number | null => (min === null ? null : Math.round(min * 60));

/** Cardio réel de la séance : tous les champs optionnels sauf le type, aucune supposition. */
export function CardioSection({ workout, programCardio }: { workout: WorkoutSession; programCardio: ProgramCardio | null }) {
  const autosave = useWorkoutAutosave(workout.id);
  const [choosingType, setChoosingType] = useState(false);

  const add = async (type: CardioType) => {
    setChoosingType(false);
    await autosave.flush();
    await autosave.commit((w) => addCardioEntry(w, type));
  };

  return (
    <Card aria-labelledby="cardio-title" className={styles.card}>
      <Eyebrow id="cardio-title">{programCardio?.label || strings.workoutScreen.cardioTitle}</Eyebrow>
      {programCardio?.targetDurationMin != null && <p className={styles.target}>{strings.workoutScreen.cardioTarget(programCardio.targetDurationMin)}</p>}
      {programCardio?.notes && <p className={styles.notes}>{programCardio.notes}</p>}
      {autosave.error !== null && (
        <div role="alert" className={styles.error}>
          <p>{autosave.error.message}</p>
          <ErrorDetails details={autosave.error.details} />
        </div>
      )}

      {workout.cardioRecords.length === 0 && !choosingType && <p className={styles.empty}>{strings.workoutScreen.noCardio}</p>}

      {workout.cardioRecords.map((entry, index) => (
        <CardioEntryEditor key={index} entry={entry} index={index} autosave={autosave} />
      ))}

      {choosingType ? (
        <div role="group" aria-label={t.chooseType} className={styles.typeChoice}>
          <p className={styles.fieldLabel}>{t.chooseType}</p>
          <div className={styles.types}>
            {CARDIO_TYPES.map((type) => (
              <button key={type} type="button" className={styles.typeButton} onClick={() => void add(type)}>
                {t.types[type]}
              </button>
            ))}
          </div>
          <Button
            variant="ghost"
            fullWidth
            onClick={() => {
              setChoosingType(false);
            }}
          >
            {strings.common.cancel}
          </Button>
        </div>
      ) : (
        <Button
          variant="secondary"
          fullWidth
          icon={<Plus aria-hidden />}
          onClick={() => {
            setChoosingType(true);
          }}
        >
          {t.add}
        </Button>
      )}
    </Card>
  );
}

function CardioEntryEditor({ entry, index, autosave }: { entry: CardioEntry; index: number; autosave: WorkoutAutosave }) {
  const [confirmRemove, setConfirmRemove] = useState(false);
  const key = (field: string) => `cardio:${String(index)}:${field}`;
  const update = (patch: Partial<CardioEntry>) => (w: WorkoutSession) => updateCardioEntry(w, index, patch);
  const minutes = secondsToMinutes(entry.durationSec);

  return (
    <div className={styles.entry} role="group" aria-label={t.entryLabel(index + 1)}>
      <div className={styles.entryHeader}>
        <p className={styles.entryTitle}>{t.entryLabel(index + 1)}</p>
        <button
          type="button"
          className={styles.removeButton}
          aria-label={`${t.remove} (${t.entryLabel(index + 1)})`}
          onClick={() => {
            setConfirmRemove(true);
          }}
        >
          <Trash2 aria-hidden />
        </button>
      </div>

      <div className={styles.types} role="group" aria-label={t.chooseType}>
        {CARDIO_TYPES.map((type) => (
          <button
            key={type}
            type="button"
            className={[styles.typeButton, entry.type === type && styles.typeSelected].filter(Boolean).join(' ')}
            aria-pressed={entry.type === type}
            onClick={() => void autosave.commit(update({ type }))}
          >
            {t.types[type]}
          </button>
        ))}
      </div>

      <TextField
        label={t.name}
        visibleLabel
        placeholder={t.namePlaceholder}
        value={entry.name}
        onValueChange={(text, immediate) => {
          autosave.save(key('name'), entry.name, text.trim(), immediate, update({ name: text }));
        }}
      />

      <div className={styles.grid}>
        <LabelledNumber label={t.duration}>
          <NumberField
            label={`${t.duration} (${t.durationUnit})`}
            mode="decimal"
            unit={t.durationUnit}
            value={minutes}
            invalidMessage={strings.exercise.invalidNumber}
            onInvalidInput={() => {
              autosave.cancel(key('duration'));
            }}
            onValueChange={(value, immediate) => {
              autosave.save(key('duration'), minutes, value, immediate, update({ durationSec: minutesToSeconds(value) }));
            }}
          />
        </LabelledNumber>
        <LabelledNumber label={t.speed}>
          <NumberField
            label={`${t.speed} (${t.speedUnit})`}
            mode="decimal"
            unit={t.speedUnit}
            value={entry.speedKmh}
            invalidMessage={strings.exercise.invalidNumber}
            onInvalidInput={() => {
              autosave.cancel(key('speed'));
            }}
            onValueChange={(value, immediate) => {
              autosave.save(key('speed'), entry.speedKmh, value, immediate, update({ speedKmh: value }));
            }}
          />
        </LabelledNumber>
        <LabelledNumber label={t.incline}>
          <NumberField
            label={`${t.incline} (${t.inclineUnit})`}
            mode="decimal"
            unit={t.inclineUnit}
            max={100}
            value={entry.inclinePct}
            invalidMessage={t.invalidIncline}
            onInvalidInput={() => {
              autosave.cancel(key('incline'));
            }}
            onValueChange={(value, immediate) => {
              autosave.save(key('incline'), entry.inclinePct, value, immediate, update({ inclinePct: value }));
            }}
          />
        </LabelledNumber>
      </div>

      <TextField
        label={t.notes}
        visibleLabel
        multiline
        value={entry.notes ?? ''}
        onValueChange={(text, immediate) => {
          const notes = normalizeText(text);
          autosave.save(key('notes'), entry.notes, notes, immediate, update({ notes }));
        }}
      />

      {confirmRemove && (
        <ConfirmSheet
          title={t.removeTitle}
          confirmLabel={t.removeConfirm}
          confirmVariant="danger"
          onConfirm={() => {
            setConfirmRemove(false);
            void autosave.flush().then(() => autosave.commit((w) => removeCardioEntry(w, index)));
          }}
          onCancel={() => {
            setConfirmRemove(false);
          }}
        >
          <p>{t.removeText}</p>
        </ConfirmSheet>
      )}
    </div>
  );
}

function LabelledNumber({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.labelled}>
      <span className={styles.fieldLabel} aria-hidden>
        {label}
      </span>
      {children}
    </div>
  );
}
