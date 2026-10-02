import { useEffect, useState } from 'react';
import { ensurePersistentStorage, type PersistenceStatus } from '../services/storageService';

/** Statut du stockage persistant (affiché discrètement dans Informations), après la demande de démarrage. */
export function usePersistenceStatus(): PersistenceStatus | undefined {
  const [status, setStatus] = useState<PersistenceStatus>();
  useEffect(() => {
    let active = true;
    void ensurePersistentStorage().then((s) => {
      if (active) setStatus(s);
    });
    return () => {
      active = false;
    };
  }, []);
  return status;
}
