import { useEffect } from 'react';
import { startDriveScheduler } from '../services/driveScheduler';

/**
 * Lance le planificateur de l'archive Drive au démarrage de l'app (V1.3). Sans configuration
 * active, il ne fait rien : aucune requête. Ne rend rien.
 */
export function DriveSyncAgent() {
  useEffect(() => startDriveScheduler(), []);
  return null;
}
