import { useLiveQuery } from 'dexie-react-hooks';
import { strings } from '../i18n/strings';
import { prepareExport, type PreparedExport } from '../services/exportService';
import { toDisplayError, type DisplayError } from '../utils/errors';

export type PreparedExportState = { ok: true; prepared: PreparedExport } | { ok: false; error: DisplayError };

/**
 * Export préparé à l'avance (SPEC §10.2) et tenu à jour : la lecture réactive recalcule
 * le fichier dès que les données changent. Au toucher, il n'y a plus qu'à le remettre,
 * ce qui permet d'appeler `navigator.share` directement dans le geste (Safari iOS).
 * Une erreur (ex. autotest d'intégrité) est capturée, jamais propagée à l'écran.
 * `undefined` = préparation en cours.
 */
export function usePreparedExport(): PreparedExportState | undefined {
  return useLiveQuery(async (): Promise<PreparedExportState> => {
    try {
      return { ok: true, prepared: await prepareExport() };
    } catch (error) {
      return { ok: false, error: toDisplayError(error, strings.export.error) };
    }
  }, []);
}
