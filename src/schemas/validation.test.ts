import { describe, expect, it } from 'vitest';
import { fixtureObject, readFixture } from '../test/fixtures';
import { parseHistoryJson, parseProgramJson } from './parse';

type Json = Record<string, unknown>;

/** Accès typé aux objets imbriqués d'un JSON de test. */
const at = (obj: unknown, ...path: (string | number)[]): Json =>
  path.reduce<unknown>((o, k) => (o as Record<string | number, unknown>)[k], obj) as Json;

const programText = (mutate?: (p: Json) => void): string => {
  const program = fixtureObject('program-example.json');
  mutate?.(program);
  return JSON.stringify(program);
};

const historyText = (mutate?: (h: Json) => void): string => {
  const history = fixtureObject('history-example.json');
  mutate?.(history);
  return JSON.stringify(history);
};

const expectProgramError = (text: string) => {
  const result = parseProgramJson(text);
  if (result.ok) throw new Error('le fichier aurait dû être refusé');
  return result.error;
};

const MINIMAL_PROGRAM = {
  schemaVersion: '1.0',
  type: 'training_program',
  programId: 'p-min',
  name: 'Minimal',
  locale: 'fr-FR',
  unitSystem: 'metric',
  createdAt: '2026-10-01T09:00:00+02:00',
  week: { id: 'w', label: 'Semaine', startDate: null, endDate: null },
  sessions: [
    {
      id: 'A',
      name: 'Séance A',
      order: 1,
      estimatedDurationMin: null,
      exercises: [
        {
          id: 'squat',
          order: 1,
          type: 'strength',
          name: 'Squat',
          category: null,
          equipment: null,
          restSec: null,
          notes: null,
          sets: [{ setNumber: 1, targetReps: 5, targetWeightKg: null }],
        },
      ],
      cardio: null,
    },
  ],
};

describe('Validation JSON — les 10 cas de SPEC §12', () => {
  it('1. accepte un programme minimal valide', () => {
    const result = parseProgramJson(JSON.stringify(MINIMAL_PROGRAM));
    expect(result.ok).toBe(true);
  });

  it('2. accepte un programme complet valide (examples/program-example.json tel quel)', () => {
    const result = parseProgramJson(readFixture('program-example.json'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.programId).toBe('prog-2026-w40');
    expect(result.value.sessions).toHaveLength(3);
  });

  it('3. refuse un champ obligatoire manquant', () => {
    const error = expectProgramError(programText((p) => delete p.name));
    expect(error.kind).toBe('invalid_schema');
    expect(error.message).toBe('Import impossible : champ obligatoire « nom » manquant.');
  });

  it('4. refuse un mauvais type (charge en texte « 47 kg »)', () => {
    const error = expectProgramError(
      programText((p) => {
        at(p, 'sessions', 0, 'exercises', 0, 'sets', 0).targetWeightKg = '47 kg';
      }),
    );
    expect(error.kind).toBe('invalid_schema');
    expect(error.message).toBe(
      'Import impossible : la série 1 de l\'exercice « Chest Press » de la séance A : charge cible invalide (nombre attendu).',
    );
  });

  it('5. refuse un mauvais schemaVersion', () => {
    const error = expectProgramError(programText((p) => (p.schemaVersion = '2.0')));
    expect(error.kind).toBe('unsupported_version');
    expect(error.message).toContain('« 2.0 »');
  });

  it('6. refuse un exercice sans id, avec le message de la SPEC', () => {
    const error = expectProgramError(programText((p) => delete at(p, 'sessions', 0, 'exercises', 1).id));
    expect(error.message).toBe('Import impossible : la séance A contient un exercice sans identifiant.');
  });

  it('7. refuse une série sans numéro', () => {
    const error = expectProgramError(programText((p) => delete at(p, 'sessions', 1, 'exercises', 0, 'sets', 2).setNumber));
    expect(error.message).toBe(
      'Import impossible : l\'exercice « Presse à cuisses » de la séance B contient une série sans numéro de série.',
    );
  });

  it('8. refuse une charge négative', () => {
    const error = expectProgramError(programText((p) => (at(p, 'sessions', 0, 'exercises', 0, 'sets', 1).targetWeightKg = -5)));
    expect(error.message).toContain('charge cible invalide (valeur négative interdite)');
  });

  it('9. refuse des reps négatives', () => {
    const error = expectProgramError(programText((p) => (at(p, 'sessions', 0, 'exercises', 0, 'sets', 0).targetReps = -1)));
    expect(error.message).toContain('répétitions cibles invalide (valeur négative interdite)');
  });

  it('10. refuse une séance sans id', () => {
    const error = expectProgramError(programText((p) => delete at(p, 'sessions', 2).id));
    expect(error.message).toBe('Import impossible : le programme contient une séance sans identifiant.');
  });
});

describe('Validation JSON — cas complémentaires', () => {
  it('refuse un JSON syntaxiquement invalide', () => {
    const error = expectProgramError('{ "schemaVersion": "1.0", ');
    expect(error.kind).toBe('invalid_json');
    expect(error.message).toBe("Import impossible : le fichier n'est pas un JSON valide.");
    expect(error.details).toHaveLength(1);
  });

  it('refuse une sauvegarde importée comme programme', () => {
    const error = expectProgramError(readFixture('history-example.json'));
    expect(error.kind).toBe('wrong_type');
  });

  it('refuse un schemaVersion manquant', () => {
    expect(expectProgramError(programText((p) => delete p.schemaVersion)).message).toContain('schemaVersion');
  });

  it('refuse reps exactes ET plage dans la même série', () => {
    const error = expectProgramError(
      programText((p) => Object.assign(at(p, 'sessions', 0, 'exercises', 0, 'sets', 0), { targetRepsMin: 8, targetRepsMax: 12 })),
    );
    expect(error.message).toContain('une seule forme autorisée');
  });

  it('refuse une plage incomplète et une plage inversée', () => {
    expect(expectProgramError(programText((p) => delete at(p, 'sessions', 0, 'exercises', 1, 'sets', 0).targetRepsMax)).message).toContain(
      'plage de répétitions est incomplète',
    );
    expect(
      expectProgramError(programText((p) => (at(p, 'sessions', 0, 'exercises', 1, 'sets', 0).targetRepsMin = 20))).message,
    ).toContain('minimum de répétitions dépasse le maximum');
  });

  it('refuse un numéro de série en double et un id d\'exercice en double', () => {
    expect(expectProgramError(programText((p) => (at(p, 'sessions', 0, 'exercises', 0, 'sets', 1).setNumber = 1))).message).toContain(
      'le numéro de série 1 est utilisé plusieurs fois',
    );
    expect(
      expectProgramError(programText((p) => (at(p, 'sessions', 0, 'exercises', 1).id = 'chest-press-machine'))).message,
    ).toContain('« chest-press-machine » est utilisé plusieurs fois');
  });

  it('accepte null pour la forme de reps non utilisée et normalise la série', () => {
    const result = parseProgramJson(
      programText((p) => Object.assign(at(p, 'sessions', 0, 'exercises', 0, 'sets', 0), { targetRepsMin: null, targetRepsMax: null })),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.sessions[0]?.exercises[0]?.sets[0]).toEqual({ setNumber: 1, targetReps: 12, targetWeightKg: 47 });
  });

  it('compte les erreurs supplémentaires et fournit les détails techniques', () => {
    const error = expectProgramError(
      programText((p) => {
        delete p.name;
        p.locale = 42;
      }),
    );
    expect(error.message).toContain('(et 1 autre erreur)');
    expect(error.details).toHaveLength(2);
  });
});

describe('Validation sauvegarde (training_history_export)', () => {
  const expectHistoryError = (text: string) => {
    const result = parseHistoryJson(text);
    if (result.ok) throw new Error('la sauvegarde aurait dû être refusée');
    return result.error;
  };

  it('accepte examples/history-example.json tel quel', () => {
    const result = parseHistoryJson(readFixture('history-example.json'));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.sessions).toHaveLength(3);
  });

  it('applique les préférences par défaut si absentes', () => {
    const result = parseHistoryJson(historyText((h) => delete h.preferences));
    expect(result.ok && result.value.preferences).toEqual({ unit: 'kg', theme: 'light' });
  });

  it('refuse un programme importé comme sauvegarde', () => {
    expect(expectHistoryError(readFixture('program-example.json')).kind).toBe('wrong_type');
  });

  it('décrit une erreur dans une séance réalisée', () => {
    const error = expectHistoryError(historyText((h) => (at(h, 'sessions', 1, 'exerciseRecords', 1, 'actualSets', 3).actualWeightKg = -45)));
    expect(error.message).toBe(
      'Restauration impossible : la série réalisée 4 de l\'exercice « Tirage vertical » de la séance w-0002 : charge invalide (valeur négative interdite).',
    );
  });

  describe('invariants SPEC §10.5 — refus en bloc', () => {
    it('plusieurs séances in_progress', () => {
      const error = expectHistoryError(
        historyText((h) => {
          for (const i of [0, 1]) Object.assign(at(h, 'sessions', i), { status: 'in_progress', completedAt: null });
        }),
      );
      expect(error.kind).toBe('invariant');
      expect(error.message).toContain('plusieurs séances sont en cours (w-0001, w-0002)');
    });

    it('activeProgramId inconnu', () => {
      expect(expectHistoryError(historyText((h) => (h.activeProgramId = 'absent'))).message).toContain('le programme actif « absent »');
    });

    it('séance liée à un programme absent', () => {
      expect(expectHistoryError(historyText((h) => (at(h, 'sessions', 0).programId = 'absent'))).message).toContain(
        'la séance « w-0001 » fait référence à un programme absent',
      );
    });

    it('id de séance ou de programme en double', () => {
      expect(expectHistoryError(historyText((h) => (at(h, 'sessions', 1).id = 'w-0001'))).message).toContain(
        "l'identifiant de séance « w-0001 »",
      );
      const duplicated = historyText((h) => (h.programs as unknown[]).push((h.programs as unknown[])[0]));
      expect(expectHistoryError(duplicated).message).toContain("l'identifiant de programme « prog-demo-w37 »");
    });

    it('completed sans completedAt, in_progress avec completedAt', () => {
      expect(expectHistoryError(historyText((h) => (at(h, 'sessions', 0).completedAt = null))).message).toContain(
        'est terminée mais n\'a pas de date de fin',
      );
      expect(expectHistoryError(historyText((h) => (at(h, 'sessions', 0).status = 'in_progress'))).message).toContain(
        'est en cours mais a une date de fin',
      );
    });
  });
});
