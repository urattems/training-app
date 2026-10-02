import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { db } from '../db/database';

export type FixtureName = 'program-example.json' | 'history-example.json';

/** Empreintes SHA-256 des fixtures contractuelles : toute modification fait échouer les tests. */
export const FIXTURE_SHA256: Record<FixtureName, string> = {
  'program-example.json': '9bced4e3cd24803a61635047b7ff351d3dd535cfe668dd3d8fa8a1fd2ec64ade',
  'history-example.json': '1fbe08ac5e13a690bfb8f20cce6cf92bb2f567156e9cb9fb5e8098f3111d48d3',
};

/** Contenu brut d'une fixture de `examples/`, telle quelle. */
export const readFixture = (name: FixtureName): string =>
  readFileSync(new URL(`../../examples/${name}`, import.meta.url), 'utf8');

export const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

/** Objet JSON modifiable dérivé d'une fixture, pour fabriquer des cas invalides. */
export const fixtureObject = (name: FixtureName): Record<string, unknown> =>
  JSON.parse(readFixture(name)) as Record<string, unknown>;

/** Repart d'une base vide (fake-indexeddb). */
export async function resetDatabase(): Promise<void> {
  db.close();
  await db.delete();
  await db.open();
}

/** Contenu complet de la base, pour vérifier qu'une opération n'a rien modifié. */
export async function dumpDatabase() {
  const [programs, workouts, settings, metadata] = await Promise.all([
    db.programs.toArray(),
    db.workouts.toArray(),
    db.settings.toArray(),
    db.metadata.toArray(),
  ]);
  return { programs, workouts, settings, metadata };
}
