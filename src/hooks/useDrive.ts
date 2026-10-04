import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { DriveSyncSettings } from '../db/database';
import { outboxSummary, taskId, type DriveNames, type DriveOutboxState, type OutboxSummary } from '../domain/driveOutbox';
import { getDriveNames, getOutbox, isSending, subscribeSending } from '../services/driveOutbox';
import { getDriveSync, isDriveActive } from '../services/driveSettings';

export interface DriveState {
  config: DriveSyncSettings;
  active: boolean;
  outbox: DriveOutboxState;
  names: DriveNames;
  summary: OutboxSummary;
  sending: boolean;
}

/** Heure courante, rafraîchie chaque minute (seuil « en attente depuis plus d'une heure »). */
function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => {
      setNow(Date.now());
    }, intervalMs);
    return () => {
      clearInterval(id);
    };
  }, [intervalMs]);
  return now;
}

/** État de l'archive Drive (configuration, file, noms gelés, envoi en cours). `undefined` = chargement. */
export function useDriveState(): DriveState | undefined {
  const now = useNow();
  const config = useLiveQuery(getDriveSync, []);
  const outbox = useLiveQuery(getOutbox, []);
  const names = useLiveQuery(getDriveNames, []);
  const sending = useSyncExternalStore(subscribeSending, isSending, isSending);
  if (config === undefined || outbox === undefined || names === undefined) return undefined;
  return { config, active: isDriveActive(config), outbox, names, summary: outboxSummary(outbox, now), sending };
}

export type SessionDriveStatus = 'sending' | 'sent' | 'waiting' | 'error';

/**
 * État d'envoi d'UNE séance (ligne discrète de l'accueil après « Terminer ») ; `null` si l'envoi
 * n'est pas actif ou si la séance n'est pas concernée (jamais envoyée ni en file).
 */
export function sessionDriveStatus(state: DriveState, sessionId: string): SessionDriveStatus | null {
  if (!state.active) return null;
  const task = state.outbox.tasks.find((t) => t.id === taskId('session', sessionId));
  if (!task) return sessionId in state.names ? 'sent' : null;
  if (task.status === 'error') return 'error';
  if (state.sending || task.lastError === null) return 'sending';
  return 'waiting';
}
