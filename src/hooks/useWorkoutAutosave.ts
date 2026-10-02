import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { WorkoutSession } from '../domain/types';
import { strings } from '../i18n/strings';
import { updateWorkout } from '../services/workoutService';
import { toDisplayError, type DisplayError } from '../utils/errors';

export type WorkoutUpdate = (workout: WorkoutSession) => WorkoutSession;

/** Délai de regroupement des frappes avant écriture (SPEC §7.5 : debounce court). */
export const AUTOSAVE_DELAY_MS = 350;

interface Pending {
  timer: ReturnType<typeof setTimeout>;
  update: WorkoutUpdate;
}

export interface WorkoutAutosave {
  /** Programme l'écriture d'un champ (la dernière valeur d'un même champ remplace la précédente). */
  schedule: (key: string, update: WorkoutUpdate) => void;
  /** Écrit immédiatement le champ (ou tous les champs) en attente. */
  flush: (key?: string) => Promise<void>;
  /** Annule l'écriture en attente d'un champ. */
  cancel: (key: string) => void;
  /**
   * Enregistre un champ : planifié pendant la frappe, immédiat au blur. Si la valeur finale
   * est déjà celle en base, rien n'est écrit (un simple tap dans un champ vide ne crée pas
   * de série vide et ne marque pas l'exercice comme commencé).
   */
  save: <T>(key: string, current: T, next: T, immediate: boolean, update: WorkoutUpdate) => void;
  /** Écrit immédiatement une action explicite (bouton). */
  commit: (update: WorkoutUpdate) => Promise<void>;
  error: DisplayError | null;
  clearError: () => void;
}

/**
 * Sauvegarde à chaque modification (SPEC §7.5) : chaque champ planifie une mise à jour
 * fonctionnelle de la séance, écrite après un court délai, ou tout de suite au blur,
 * quand l'app passe en arrière-plan (`visibilitychange`), à `pagehide` et au démontage.
 * Les mises à jour sont des fonctions pures appliquées sur l'état le plus récent en base
 * (transactions sérialisées) : deux champs modifiés coup sur coup ne s'écrasent pas.
 */
export function useWorkoutAutosave(workoutId: string): WorkoutAutosave {
  const pending = useRef(new Map<string, Pending>());
  const [error, setError] = useState<DisplayError | null>(null);

  const run = useCallback(
    async (update: WorkoutUpdate) => {
      try {
        await updateWorkout(workoutId, update);
      } catch (e) {
        console.error(e);
        setError(toDisplayError(e, strings.exercise.saveError));
      }
    },
    [workoutId],
  );

  const flush = useCallback(
    async (key?: string) => {
      const entries = key === undefined ? [...pending.current.entries()] : [[key, pending.current.get(key)] as const];
      const writes: Promise<void>[] = [];
      for (const [k, item] of entries) {
        if (!item) continue;
        clearTimeout(item.timer);
        pending.current.delete(k);
        writes.push(run(item.update));
      }
      await Promise.all(writes);
    },
    [run],
  );

  const schedule = useCallback(
    (key: string, update: WorkoutUpdate) => {
      const previous = pending.current.get(key);
      if (previous) clearTimeout(previous.timer);
      const timer = setTimeout(() => {
        pending.current.delete(key);
        void run(update);
      }, AUTOSAVE_DELAY_MS);
      pending.current.set(key, { timer, update });
    },
    [run],
  );

  const cancel = useCallback((key: string) => {
    const item = pending.current.get(key);
    if (item) clearTimeout(item.timer);
    pending.current.delete(key);
  }, []);

  const save = useCallback(
    <T,>(key: string, current: T, next: T, immediate: boolean, update: WorkoutUpdate) => {
      if (Object.is(current, next)) {
        cancel(key);
        return;
      }
      schedule(key, update);
      if (immediate) void flush(key);
    },
    [cancel, schedule, flush],
  );

  const commit = useCallback(async (update: WorkoutUpdate) => run(update), [run]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') void flush();
    };
    const onPageHide = () => void flush();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [flush]);

  // Démontage (navigation, fermeture) : les écritures en attente partent immédiatement,
  // de façon synchrone (effet de layout), avant tout autre traitement.
  useLayoutEffect(
    () => () => {
      void flush();
    },
    [flush],
  );

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return { schedule, flush, cancel, save, commit, error, clearError };
}
