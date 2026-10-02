import { DomainError } from '../domain/errors';

export interface DisplayError {
  /** Message destiné à l'utilisateur. */
  message: string;
  /** Détails techniques (« TypeError: … »), affichés sur demande pour déboguer sur iPhone. */
  details: string[];
}

/** Ligne technique lisible : nom et message de l'erreur (et de sa cause éventuelle). */
export function technicalDetails(error: unknown): string[] {
  if (error instanceof Error) {
    const lines = [`${error.name}: ${error.message}`];
    if (error.cause !== undefined) lines.push(...technicalDetails(error.cause).map((l) => `cause — ${l}`));
    return lines;
  }
  return [String(error)];
}

/** Erreur métier attendue → son message ; sinon message générique + détails techniques. */
export function toDisplayError(error: unknown, fallbackMessage: string): DisplayError {
  return {
    message: error instanceof DomainError ? error.message : fallbackMessage,
    details: technicalDetails(error),
  };
}
