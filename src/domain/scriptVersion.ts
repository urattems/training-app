/**
 * Version du script « Muscu Sync » (V1.6.2), règles pures. Le script annonce sa version dans la
 * réponse de `ping` (« sync-2 », « sync-3 »…). Seul le format `sync-<entier>` est compris : toute
 * autre valeur (absente, illisible, format inconnu) est traitée comme INCONNUE, donc non supportée.
 */

const SYNC_VERSION = /^sync-(\d{1,6})$/;

/** Numéro de version (« sync-10 » → 10), `null` si la valeur n'est pas une version lisible. */
export function parseSyncVersion(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = SYNC_VERSION.exec(value.trim());
  return match ? Number(match[1]) : null;
}

/** Version à mémoriser après un `ping` : la chaîne si elle est lisible, sinon `null` (inconnue). */
export const readableSyncVersion = (value: unknown): string | null => (parseSyncVersion(value) === null ? null : (value as string).trim());

/** Première version qui connaît l'action `note_deletion` (suppressions de mensurations). */
export const NOTE_DELETION_SINCE = 3;

/** `note_deletion` est-elle comprise par ce script ? Comparaison NUMÉRIQUE (« sync-10 » > « sync-3 »). */
export function supportsNoteDeletion(version: string | null): boolean {
  const n = parseSyncVersion(version);
  return n !== null && n >= NOTE_DELETION_SINCE;
}
