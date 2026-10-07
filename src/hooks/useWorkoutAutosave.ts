import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { WorkoutSession } from '../domain/types';
import { strings } from '../i18n/strings';
import { updateWorkout } from '../services/workoutService';
import { toDisplayError, type DisplayError } from '../utils/errors';

export type WorkoutUpdate = (workout: WorkoutSession) => WorkoutSession;

/** Écriture d'un champ pour une valeur donnée (sert aussi à rétablir la valeur d'avant la saisie). */
export type FieldUpdate<T> = (value: T) => WorkoutUpdate;

/**
 * Rétablissement précis d'un champ à partir de la séance telle qu'elle était en base juste avant
 * la saisie (ex. une série qui n'existait pas doit redevenir absente, pas vide).
 */
export type FieldRestore = (before: WorkoutSession) => WorkoutUpdate;

/** Écriture en file : `key` null = action explicite (jamais fusionnée). */
interface QueuedWrite {
  key: string | null;
  update: WorkoutUpdate;
}

/**
 * Saisie d'un champ (de sa première modification jusqu'au blur ; après le blur, l'état reste la
 * référence du champ tant qu'aucune valeur ne vient d'ailleurs) :
 * - `origin` : valeur en base avant la saisie (rétablie si la saisie devient invalide) ;
 * - `seen` : valeurs que cette saisie a elle-même écrites (une valeur venue de la base qui n'en
 *   fait pas partie vient d'ailleurs, ex. « Comme prévu » : c'est une nouvelle saisie) ;
 * - `sent` : dernière valeur mise en file (comparaison « rien n'a changé »).
 */
/** Valeurs gardées par champ pour reconnaître un affichage en retard (borne la mémoire). */
const MAX_SEEN = 20;

interface FieldEdit {
  origin: unknown;
  seen: unknown[];
  sent: unknown;
  build: FieldUpdate<never>;
  restore: FieldRestore | undefined;
  /**
   * Saisie en cours : séance en base juste avant SA première écriture. Un objet par saisie, capturé
   * par ses écritures : une écriture d'une saisie précédente encore en file ne le remplit jamais.
   */
  burst: { before: WorkoutSession | undefined };
}

export interface WorkoutAutosave {
  /** Attend que toutes les écritures en file soient faites (avant une action, au démontage…). */
  flush: () => Promise<void>;
  /**
   * Saisie devenue invalide (« 4747 », « 4,7,5 ») : si une valeur intermédiaire valide a déjà été
   * écrite pendant cette saisie, la valeur d'avant la saisie est rétablie en base.
   */
  cancel: (key: string) => void;
  /**
   * Enregistre un champ IMMÉDIATEMENT (file sérialisée, aucun délai). Si la valeur est déjà
   * celle en base, rien n'est écrit (un simple tap dans un champ vide ne crée pas de série vide
   * et ne marque pas l'exercice comme commencé). `immediate` (blur) termine la saisie du champ.
   */
  save: <T>(key: string, current: T, next: T, immediate: boolean, build: FieldUpdate<T>, restore?: FieldRestore) => void;
  /** Écrit une action explicite (bouton), dans la même file, après les saisies déjà en file. */
  commit: (update: WorkoutUpdate) => Promise<void>;
  error: DisplayError | null;
  /** Heure (ISO) du dernier enregistrement réussi, pour le retour visuel. */
  savedAt: string | null;
  clearError: () => void;
}

/**
 * Sauvegarde à chaque modification (SPEC §7.5, V1.3.2) : chaque modification réelle part
 * TOUT DE SUITE dans une file d'écritures sérialisée (une transaction IndexedDB à la fois, dans
 * l'ordre des frappes : une frappe ancienne n'écrase jamais une plus récente). Tant qu'une
 * écriture d'un champ attend son tour, une nouvelle valeur du même champ la remplace (la
 * dernière gagne, pas d'accumulation). Le blur, le passage en arrière-plan
 * (`visibilitychange`), `pagehide` et le démontage restent des filets : ils vident la file.
 * Les mises à jour sont des fonctions pures appliquées sur l'état le plus récent en base.
 */
export function useWorkoutAutosave(workoutId: string): WorkoutAutosave {
  const queue = useRef<QueuedWrite[]>([]);
  const draining = useRef<Promise<void> | null>(null);
  const edits = useRef(new Map<string, FieldEdit>());
  const [error, setError] = useState<DisplayError | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const run = useCallback(
    async (update: WorkoutUpdate) => {
      try {
        await updateWorkout(workoutId, update);
        setSavedAt(new Date().toISOString());
      } catch (e) {
        // Après le démontage, plus d'écran pour l'afficher : console seulement (DECISIONS V1.3.2).
        console.error(e);
        setError(toDisplayError(e, strings.exercise.saveError));
      }
    },
    [workoutId],
  );

  const drain = useCallback(async () => {
    for (let item = queue.current.shift(); item !== undefined; item = queue.current.shift()) {
      await run(item.update);
    }
    draining.current = null;
  }, [run]);

  /** Met une écriture en file et la lance tout de suite si la file est libre. */
  const enqueue = useCallback(
    (key: string | null, update: WorkoutUpdate): Promise<void> => {
      const waiting = key === null ? undefined : queue.current.find((item) => item.key === key);
      if (waiting) waiting.update = update;
      else queue.current.push({ key, update });
      draining.current ??= drain();
      return draining.current;
    },
    [drain],
  );

  const flush = useCallback(async () => {
    while (draining.current !== null) await draining.current;
  }, []);

  const save = useCallback(
    <T,>(key: string, current: T, next: T, immediate: boolean, build: FieldUpdate<T>, restore?: FieldRestore) => {
      let edit = edits.current.get(key);
      // Valeur de la base qui ne vient pas de cette saisie (ex. « Comme prévu ») : nouvelle saisie.
      if (edit && !edit.seen.some((v) => Object.is(v, current))) edit = undefined;
      edit ??= { origin: current, seen: [current], sent: current, build, restore, burst: { before: undefined } };
      edit.build = build;
      edit.restore = restore;
      if (!Object.is(edit.sent, next)) {
        edit.sent = next;
        edit.seen.push(next);
        const burst = edit.burst;
        const update = build(next);
        void enqueue(key, (w) => {
          burst.before ??= w;
          return update(w);
        });
      }
      if (immediate) {
        // Fin de saisie (blur). La dernière valeur envoyée reste la RÉFÉRENCE du champ (V1.6.3) :
        // l'écran peut encore afficher une valeur antérieure (lecture réactive pas encore
        // rafraîchie). Oublier la saisie ferait comparer la saisie suivante à cette valeur
        // périmée : vider le champ juste après le blur n'aurait alors rien écrit.
        edit.origin = edit.sent;
        edit.burst = { before: undefined };
        edit.seen = edit.seen.slice(-MAX_SEEN);
      }
      edits.current.set(key, edit);
    },
    [enqueue],
  );

  const cancel = useCallback(
    (key: string) => {
      const edit = edits.current.get(key);
      if (!edit || Object.is(edit.sent, edit.origin)) return;
      edit.sent = edit.origin;
      const { restore, burst } = edit;
      const fallback = edit.build(edit.origin as never);
      // L'état « avant » est connu dès que la première écriture a été appliquée (file sérialisée).
      void enqueue(key, (w) => (restore && burst.before ? restore(burst.before)(w) : fallback(w)));
    },
    [enqueue],
  );

  const commit = useCallback((update: WorkoutUpdate) => enqueue(null, update), [enqueue]);

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

  // Démontage (navigation, fermeture) : les écritures déjà lancées se terminent d'elles-mêmes ;
  // la file est vidée jusqu'au bout.
  useLayoutEffect(
    () => () => {
      void flush();
    },
    [flush],
  );

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return { flush, cancel, save, commit, error, savedAt, clearError };
}
