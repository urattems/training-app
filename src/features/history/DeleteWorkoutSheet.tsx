import { ConfirmSheet } from '../../components/ConfirmSheet';
import type { WorkoutSession } from '../../domain/types';
import { countEnteredSets } from '../../domain/workout';
import { strings } from '../../i18n/strings';
import { deleteAbandonedWorkout, deleteWorkout } from '../../services/historyService';
import { formatDayLong } from '../../utils/format';

const t = strings.history;

/**
 * Confirmation de suppression, commune au détail et au balayage de la liste (V1.3.3).
 * Séance abandonnée : nom, date, nombre de séries saisies, caractère définitif.
 * Autre statut (détail seulement) : texte existant, inchangé.
 */
export function DeleteWorkoutSheet({
  workout,
  busy,
  onConfirm,
  onCancel,
}: {
  workout: WorkoutSession;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const date = formatDayLong(workout.date);
  if (workout.status !== 'abandoned') {
    return (
      <ConfirmSheet title={t.deleteTitle} confirmLabel={t.deleteConfirm} confirmVariant="danger" busy={busy} onConfirm={onConfirm} onCancel={onCancel}>
        <p>{t.deleteText(workout.sessionName, date)}</p>
      </ConfirmSheet>
    );
  }
  return (
    <ConfirmSheet
      title={t.deleteAbandonedTitle}
      confirmLabel={t.deleteAbandonedConfirm}
      confirmVariant="danger"
      busy={busy}
      onConfirm={onConfirm}
      onCancel={onCancel}
    >
      <p>{t.deleteAbandonedSummary(workout.sessionName, date, countEnteredSets(workout))}</p>
      <p>{t.deleteAbandonedText}</p>
    </ConfirmSheet>
  );
}

/** Service de suppression selon le statut : une séance abandonnée passe par le service restreint. */
export const removeWorkout = (workout: WorkoutSession): Promise<void> =>
  workout.status === 'abandoned' ? deleteAbandonedWorkout(workout.id) : deleteWorkout(workout.id);
