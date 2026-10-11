import { describe, expect, it } from 'vitest';
import { importFailure } from '../schemas/errors';
import { buildCoachErrorReport } from './coachErrorReport';

describe('Texte « Copier l’erreur pour mon coach » (V1.8-SPEC §4.2)', () => {
  it('sans détail technique (programId déjà importé) : pas de section « Erreurs »', () => {
    const failure = importFailure('duplicate_program', 'program', 'un programme avec l’identifiant « prog-1 » existe déjà.');
    expect(buildCoachErrorReport(failure, '9.9.9')).toBe(
      [
        "Erreur d'import d'un programme dans Training App (version 9.9.9).",
        'Format attendu : "type": "training_program", "schemaVersion": "1.0".',
        '',
        "Message de l'app : Import impossible : un programme avec l’identifiant « prog-1 » existe déjà.",
        '',
        'Corrige et renvoie le JSON complet, seul, conforme au guide du coach : https://raw.githubusercontent.com/urattems/training-app/main/public/coach.md',
      ].join('\n'),
    );
  });

  it('avec détails : une ligne par erreur, emplacement compris, dans l’ordre', () => {
    const failure = importFailure('invalid_schema', 'program', 'détail.', ['a.b — custom : un', 'c — invalid_type : deux']);
    const lines = buildCoachErrorReport(failure, '1.8.0').split('\n');
    expect(lines.slice(4, 8)).toEqual(['', 'Erreurs (emplacement — détail) :', '- a.b — custom : un', '- c — invalid_type : deux']);
    expect(lines.at(-1)).toBe('Corrige et renvoie le JSON complet, seul, conforme au guide du coach : https://raw.githubusercontent.com/urattems/training-app/main/public/coach.md');
  });
});
