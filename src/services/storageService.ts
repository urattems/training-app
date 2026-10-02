/** Statut du stockage persistant affiché dans Informations. */
export type PersistenceStatus = 'granted' | 'denied' | 'unavailable';

export type StorageLike = Partial<Pick<StorageManager, 'persist' | 'persisted'>>;

/** `navigator.storage` n'existe qu'en contexte sécurisé (HTTPS, localhost). */
const defaultStorage = (): StorageLike | undefined =>
  typeof navigator === 'undefined' ? undefined : (navigator as { storage?: StorageLike }).storage;

/**
 * Demande au navigateur de ne pas purger les données (SPEC §9), au démarrage.
 * Détection de fonctionnalité, appel silencieux : aucun message, aucune erreur propagée.
 * Ce n'est pas une garantie : le rappel d'export reste la protection principale.
 */
export async function requestPersistentStorage(storage: StorageLike | undefined = defaultStorage()): Promise<PersistenceStatus> {
  if (typeof storage?.persist !== 'function') return 'unavailable';
  try {
    if (typeof storage.persisted === 'function' && (await storage.persisted())) return 'granted';
    return (await storage.persist()) ? 'granted' : 'denied';
  } catch {
    return 'unavailable';
  }
}

let startupRequest: Promise<PersistenceStatus> | undefined;

/**
 * Demande unique au démarrage de l'app : la même promesse sert à l'affichage du statut,
 * qui ne peut donc pas lire « non » avant la fin de la demande.
 */
export function ensurePersistentStorage(): Promise<PersistenceStatus> {
  startupRequest ??= requestPersistentStorage();
  return startupRequest;
}
