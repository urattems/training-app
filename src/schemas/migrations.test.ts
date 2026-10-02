import { describe, expect, it } from 'vitest';
import { SCHEMA_MIGRATIONS, migrateToVersion, type SchemaMigration } from './migrations';

const deepFreeze = <T>(value: T): T => {
  if (typeof value === 'object' && value !== null) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
};

// Chaîne factice, définie uniquement pour tester le runner (aucune migration réelle en V1).
const FAKE_CHAIN: SchemaMigration[] = [
  { from: '0.8', to: '0.9', migrate: (d) => ({ ...d, renamed: d.old, old: undefined }) },
  { from: '0.9', to: '1.0', migrate: (d) => ({ ...d, added: true }) },
];

describe('Migrations de schéma', () => {
  it('V1 : aucune migration déclarée, un document 1.0 passe inchangé', () => {
    expect(SCHEMA_MIGRATIONS).toHaveLength(0);
    const doc = deepFreeze({ schemaVersion: '1.0', a: 1 });
    const result = migrateToVersion(doc);
    expect(result).toEqual({ ok: true, document: doc, appliedSteps: [] });
  });

  it('applique la chaîne dans l\'ordre et met à jour schemaVersion', () => {
    const result = migrateToVersion({ schemaVersion: '0.8', old: 'x' }, FAKE_CHAIN, '1.0');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.appliedSteps).toEqual(['0.8 → 0.9', '0.9 → 1.0']);
    expect(result.document).toMatchObject({ schemaVersion: '1.0', renamed: 'x', added: true });
  });

  it('ne modifie jamais le document d\'entrée', () => {
    const input = deepFreeze({ schemaVersion: '0.8', old: 'x', nested: { a: [1, 2] } });
    expect(() => migrateToVersion(input, FAKE_CHAIN, '1.0')).not.toThrow();
    expect(input).toEqual({ schemaVersion: '0.8', old: 'x', nested: { a: [1, 2] } });
  });

  it('refuse une version future ou inconnue', () => {
    expect(migrateToVersion({ schemaVersion: '2.0' })).toEqual({ ok: false, reason: 'unsupported_version', version: '2.0' });
    expect(migrateToVersion({ schemaVersion: '0.5' }, FAKE_CHAIN, '1.0')).toMatchObject({ ok: false, version: '0.5' });
  });

  it('refuse un document sans version', () => {
    expect(migrateToVersion({})).toEqual({ ok: false, reason: 'missing_version' });
  });

  it('ne boucle pas sur une chaîne cyclique', () => {
    const cycle: SchemaMigration[] = [
      { from: 'a', to: 'b', migrate: (d) => d },
      { from: 'b', to: 'a', migrate: (d) => d },
    ];
    expect(migrateToVersion({ schemaVersion: 'a' }, cycle, '1.0')).toMatchObject({ ok: false });
  });
});
