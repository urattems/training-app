import type { Dexie } from 'dexie';

/**
 * Incident de connexion à la base partagée entre onglets (V1.2, première montée de version) :
 * - `blocked` : CET onglet veut monter la base en version supérieure, mais un autre onglet ou
 *   une autre fenêtre de l'app garde une connexion ouverte sur l'ancienne version. La mise à
 *   jour attend (aucune donnée n'est touchée) ; elle reprend seule dès que l'autre se ferme.
 * - `superseded` : une version plus récente de l'app vient d'ouvrir la base ailleurs. Dexie
 *   ferme alors la connexion de cet onglet pour la laisser passer (comportement par défaut) :
 *   cet onglet doit être rechargé pour continuer avec le nouveau code.
 */
export type ConnectionIssue = 'blocked' | 'superseded';

let current: ConnectionIssue | null = null;
const listeners = new Set<() => void>();

export const getConnectionIssue = (): ConnectionIssue | null => current;

export function setConnectionIssue(issue: ConnectionIssue | null): void {
  if (issue === current) return;
  current = issue;
  for (const listener of listeners) listener();
}

export function subscribeConnectionIssue(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Branche les événements Dexie sur l'état ci-dessus. Les gestionnaires par défaut de Dexie
 * restent actifs (avertissement console, fermeture de la connexion sur `versionchange`).
 */
export function watchConnection(db: Dexie): void {
  db.on('blocked', (event) => {
    // Suppression de base (newVersion nul) : cas des outils de développement, sans message.
    if (event.newVersion) setConnectionIssue('blocked');
  });
  // Ouverture terminée (y compris après un blocage levé) : plus rien à signaler.
  db.on(
    'ready',
    () => {
      if (current === 'blocked') setConnectionIssue(null);
    },
    true,
  );
  db.on('versionchange', (event) => {
    if (event.newVersion) setConnectionIssue('superseded');
  });
}
