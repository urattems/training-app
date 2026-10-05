/**
 * Remplacement d'un exercice POUR UNE SÉANCE (V1.3.1). Règles pures.
 *
 * Principe verrouillé : quand une machine ou un exercice n'est pas disponible, l'utilisateur le
 * remplace pour CETTE séance. Le prévu (`targetSets`, `restSec`, programme) reste intact ; ce qui
 * a été réellement fait porte le nom choisi. Le programme du coach n'est jamais modifié et le
 * remplacement ne se propage pas aux séances futures.
 *
 * Modèle, sans changement de format JSON :
 * - `programExerciseId` : inchangé (lien vers la prescription, clé de l'écran et de l'ordre réel) ;
 * - `exerciseName` : le nom choisi ;
 * - `exerciseId` : `sub-` + slug du nom choisi (même nom = même identifiant = historique propre) ;
 * - « remplacé » = `exerciseId` différent de `programExerciseId`.
 */
import { strings } from '../i18n/strings';
import type { WorkoutExercise } from './types';

const t = strings.replace.errors;

/** Préfixe de l'identifiant d'un exercice remplaçant. */
export const REPLACEMENT_ID_PREFIX = 'sub-';
/** Longueur maximale du nom saisi, après suppression des espaces de début et de fin. */
export const MAX_EXERCISE_NAME_LENGTH = 60;
/** Longueur maximale du slug (le préfixe `sub-` s'y ajoute). */
export const MAX_SLUG_LENGTH = 40;

/** Minuscules, sans accents ni ligatures : base du slug et des comparaisons de noms. */
const fold = (text: string): string =>
  text
    .toLowerCase()
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/\p{M}/gu, '');

/** Clé de comparaison d'un nom : « Leg-Press », « leg press » et « Lég Press » sont le même nom. */
export const nameKey = (name: string): string =>
  fold(name)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/**
 * Slug d'un nom : minuscules, sans accents, tout caractère non alphanumérique remplacé par `-`,
 * tirets fusionnés (et retirés aux extrémités), 40 caractères au maximum.
 */
export const slugify = (name: string): string => nameKey(name).slice(0, MAX_SLUG_LENGTH).replace(/-+$/, '');

/** `sub-` + slug : le même nom donne toujours le même identifiant. */
export const replacementExerciseId = (name: string): string => `${REPLACEMENT_ID_PREFIX}${slugify(name)}`;

/** Un exercice est remplacé quand son identifiant n'est plus celui de la prescription. */
export const isReplaced = (record: Pick<WorkoutExercise, 'exerciseId' | 'programExerciseId'>): boolean =>
  record.exerciseId !== record.programExerciseId;

/**
 * Nom de l'exercice PRÉVU : le nom du snapshot tant que rien n'est remplacé, sinon celui du
 * programme d'origine (conservé, même archivé). `null` si le programme ne le connaît plus.
 */
export function plannedName(record: WorkoutExercise, programExerciseName: string | undefined): string | null {
  return isReplaced(record) ? (programExerciseName ?? null) : record.exerciseName;
}

export type ResolvedName =
  | { ok: true; exerciseId: string; exerciseName: string; restoresPlanned: boolean }
  | { ok: false; message: string };

/**
 * Valide le nom saisi et calcule l'identité de l'exercice réalisé.
 * - 1 à 60 caractères après suppression des espaces de début et de fin, sans caractère de contrôle,
 *   avec au moins une lettre ou un chiffre (sinon le slug serait vide) ;
 * - le nom d'origine (à la casse, aux accents et à la ponctuation près) retire le remplacement :
 *   `exerciseId = programExerciseId` et nom du programme ;
 * - refusé s'il correspond à un autre exercice de la même séance (même nom ou même identifiant).
 */
export function resolveExerciseName(
  raw: string,
  context: {
    programExerciseId: string;
    plannedName: string;
    others: readonly Pick<WorkoutExercise, 'exerciseId' | 'exerciseName'>[];
  },
): ResolvedName {
  const name = raw.trim();
  if (name === '') return { ok: false, message: t.empty };
  if (Array.from(name).length > MAX_EXERCISE_NAME_LENGTH) return { ok: false, message: t.tooLong(MAX_EXERCISE_NAME_LENGTH) };
  if (/\p{Cc}/u.test(name)) return { ok: false, message: t.control };
  const key = nameKey(name);
  if (key === '') return { ok: false, message: t.noAlphanumeric };

  const restores = key === nameKey(context.plannedName);
  const exerciseId = restores ? context.programExerciseId : replacementExerciseId(name);
  const exerciseName = restores ? context.plannedName : name;
  const clash = context.others.some((other) => other.exerciseId === exerciseId || nameKey(other.exerciseName) === nameKey(exerciseName));
  if (clash) return { ok: false, message: t.duplicate(exerciseName) };
  return { ok: true, exerciseId, exerciseName, restoresPlanned: restores };
}
