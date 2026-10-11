import { strings } from '../i18n/strings';
import { SCHEMA_VERSION } from '../schemas/common';
import type { ImportFailure } from '../schemas/errors';
import { COACH_GUIDE_URL } from './coachPrompt';

const t = strings.coachError;

/**
 * Texte de « Copier l'erreur pour mon coach » (V1.8-SPEC §4.2) : version de l'app, format attendu,
 * message de l'app, chaque erreur avec son emplacement (détails existants, inchangés), puis la
 * consigne de correction suivie de l'adresse du guide. Aucune donnée personnelle ni réglage.
 */
export function buildCoachErrorReport(failure: ImportFailure, appVersion: string): string {
  const errors = failure.details.length > 0 ? ['', t.errors, ...failure.details.map((line) => `- ${line}`)] : [];
  return [t.title(appVersion), t.expected(SCHEMA_VERSION), '', t.message(failure.message), ...errors, '', t.instruction(COACH_GUIDE_URL)].join('\n');
}
