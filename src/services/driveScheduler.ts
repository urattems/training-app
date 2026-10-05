/**
 * Planificateur des envois Drive (V1.3 spec §6). Déclencheurs : démarrage de l'app, retour au
 * premier plan, événement réseau « online », 2 s après une mise en file, reprises programmées
 * (30 s, 2 min, 10 min, 1 h), bouton « Envoyer maintenant ». iOS n'exécute rien en arrière-plan :
 * un envoi interrompu reprend à la prochaine ouverture (attendu).
 */
import { nextWakeUp } from '../domain/driveOutbox';
import { enqueueWeeklyIfDue, getOutbox, onEnqueue, processDriveOutbox } from './driveOutbox';

let timer: ReturnType<typeof setTimeout> | null = null;

/** Programme la prochaine reprise automatique d'après la file. */
async function scheduleNext(): Promise<void> {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  const wake = nextWakeUp(await getOutbox());
  if (wake === null) return;
  timer = setTimeout(() => {
    timer = null;
    void run('timer');
  }, Math.max(0, wake - Date.now()));
}

async function run(mode: 'all' | 'timer'): Promise<void> {
  try {
    await processDriveOutbox(mode);
    await scheduleNext();
  } catch {
    // Jamais d'exception vers l'interface.
  }
}

/** « Envoyer maintenant » : toutes les tâches en attente, sans attendre leur heure de reprise. */
export const sendDriveNow = (): Promise<void> => run('all');

/** Démarre l'écoute (une fois, au montage de l'app). Renvoie la fonction d'arrêt. */
export function startDriveScheduler(): () => void {
  const onVisible = () => {
    if (document.visibilityState === 'visible') void run('all');
  };
  const onOnline = () => {
    void run('all');
  };
  const stopEnqueue = onEnqueue(() => {
    void scheduleNext();
  });
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('online', onOnline);
  // Ouverture de l'app : copie hebdomadaire si la dernière CONFIRMÉE a 7 jours ou plus (§7).
  void enqueueWeeklyIfDue().then(() => run('all'));
  return () => {
    stopEnqueue();
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('online', onOnline);
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
}
