/** Détail d'une séance du programme, éventuellement centré sur un exercice. */
export const programSessionPath = (sessionId: string, exerciseId?: string): string =>
  `/program/${encodeURIComponent(sessionId)}${exerciseId ? `?exercise=${encodeURIComponent(exerciseId)}` : ''}`;
