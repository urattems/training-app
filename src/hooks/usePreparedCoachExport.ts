import { useEffect, useState } from 'react';
import { strings } from '../i18n/strings';
import { prepareCoachExport, type CoachSelectionRequest, type PreparedCoachExport } from '../services/coachExportService';
import { toDisplayError, type DisplayError } from '../utils/errors';

export type PreparedCoachExportState =
  | { status: 'idle' }
  | { status: 'preparing' }
  | { status: 'ready'; prepared: PreparedCoachExport }
  | { status: 'error'; error: DisplayError };

type Settled = { request: CoachSelectionRequest } & ({ ok: true; prepared: PreparedCoachExport } | { ok: false; error: DisplayError });

/** Délai après le dernier changement de sélection, pour ne pas préparer à chaque case cochée. */
export const COACH_PREPARE_DELAY_MS = 250;

/**
 * Export pour le coach préparé à l'avance, à chaque changement de sélection (après un léger
 * délai) : au toucher, le partage ou la copie part immédiatement, dans le geste (Safari iOS).
 * `request` doit être mémoïsé ; `null` = rien de sélectionné.
 */
export function usePreparedCoachExport(request: CoachSelectionRequest | null, delayMs = COACH_PREPARE_DELAY_MS): PreparedCoachExportState {
  const [settled, setSettled] = useState<Settled | null>(null);

  useEffect(() => {
    if (request === null) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      prepareCoachExport(request).then(
        (prepared) => {
          if (!cancelled) setSettled({ request, ok: true, prepared });
        },
        (error: unknown) => {
          console.error(error);
          if (!cancelled) setSettled({ request, ok: false, error: toDisplayError(error, strings.coachExport.error) });
        },
      );
    }, delayMs);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [request, delayMs]);

  if (request === null) return { status: 'idle' };
  // Résultat d'une sélection précédente : le fichier n'est plus à jour.
  if (settled?.request !== request) return { status: 'preparing' };
  return settled.ok ? { status: 'ready', prepared: settled.prepared } : { status: 'error', error: settled.error };
}
