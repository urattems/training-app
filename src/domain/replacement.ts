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
 *   si le slug est TRONQUÉ (nom long), un suffixe d'empreinte du nom complet le rend unique (V1.3.2) ;
 * - « remplacé » = `exerciseId` différent de `programExerciseId`.
 */
import { strings } from '../i18n/strings';
import type { WorkoutExercise } from './types';

const t = strings.replace.errors;

/** Préfixe de l'identifiant d'un exercice remplaçant. */
export const REPLACEMENT_ID_PREFIX = 'sub-';
const REPLACEMENT_ID_PREFIX_LENGTH = REPLACEMENT_ID_PREFIX.length;
/** Longueur maximale du nom saisi, après suppression des espaces de début et de fin. */
export const MAX_EXERCISE_NAME_LENGTH = 60;
/** Longueur maximale du slug (le préfixe `sub-` s'y ajoute). */
export const MAX_SLUG_LENGTH = 40;
/** Longueur de l'empreinte ajoutée aux slugs tronqués (FNV-1a 32 bits en base 36). */
export const NAME_HASH_LENGTH = 7;
/** Longueur maximale d'un identifiant d'exercice remplaçant : `sub-` + 40 + `-` + 7. */
export const MAX_REPLACEMENT_ID_LENGTH = REPLACEMENT_ID_PREFIX_LENGTH + MAX_SLUG_LENGTH + 1 + NAME_HASH_LENGTH;

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

/**
 * Empreinte déterministe d'une clé de nom (FNV-1a 32 bits, base 36, 7 caractères).
 * Pure et stable d'une version à l'autre : un même nom donne toujours la même empreinte.
 */
export function nameHash(key: string): string {
  let hash = 0x811c9dc5;
  for (const char of key) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36).padStart(NAME_HASH_LENGTH, '0');
}

/** Le slug du nom est-il coupé à 40 caractères ? (nom long) */
export const isSlugTruncated = (name: string): boolean => nameKey(name).length > MAX_SLUG_LENGTH;

/**
 * `sub-` + slug : le même nom donne toujours le même identifiant.
 * V1.3.2 : si le slug est tronqué, ` -<empreinte du nom complet>` est ajouté. Deux noms longs qui
 * partagent leurs 40 premiers caractères ne fusionnent plus. Les noms courts gardent EXACTEMENT
 * l'identifiant de la V1.3.1.
 */
export const replacementExerciseId = (name: string): string =>
  isSlugTruncated(name)
    ? `${REPLACEMENT_ID_PREFIX}${slugify(name)}-${nameHash(nameKey(name))}`
    : `${REPLACEMENT_ID_PREFIX}${slugify(name)}`;

/** Exercices déjà réalisés (historique) : sert à garder l'identifiant d'un nom long déjà utilisé. */
export type HistoryRecord = Pick<WorkoutExercise, 'exerciseId' | 'exerciseName'>;

/**
 * Identifiant d'un nom pour cette séance. Continuité V1.3.1 → V1.3.2 : pour un nom LONG déjà
 * utilisé comme remplaçant (identifiant `sub-` sans empreinte, calculé avant la V1.3.2), on
 * réutilise l'identifiant de l'historique, pour que sa courbe ne soit pas coupée en deux.
 */
export function replacementIdFor(name: string, history: readonly HistoryRecord[] = []): string {
  if (isSlugTruncated(name)) {
    const key = nameKey(name);
    const known = history.find((r) => r.exerciseId.startsWith(REPLACEMENT_ID_PREFIX) && nameKey(r.exerciseName) === key);
    if (known) return known.exerciseId;
  }
  return replacementExerciseId(name);
}

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
    /** Exercices des séances enregistrées (continuité des noms longs, V1.3.2). */
    history?: readonly HistoryRecord[];
  },
): ResolvedName {
  const name = raw.trim();
  if (name === '') return { ok: false, message: t.empty };
  if (Array.from(name).length > MAX_EXERCISE_NAME_LENGTH) return { ok: false, message: t.tooLong(MAX_EXERCISE_NAME_LENGTH) };
  if (/\p{Cc}/u.test(name)) return { ok: false, message: t.control };
  const key = nameKey(name);
  if (key === '') return { ok: false, message: t.noAlphanumeric };

  const restores = key === nameKey(context.plannedName);
  const exerciseId = restores ? context.programExerciseId : replacementIdFor(name, context.history);
  const exerciseName = restores ? context.plannedName : name;
  const clash = context.others.some((other) => other.exerciseId === exerciseId || nameKey(other.exerciseName) === nameKey(exerciseName));
  if (clash) return { ok: false, message: t.duplicate(exerciseName) };
  return { ok: true, exerciseId, exerciseName, restoresPlanned: restores };
}
