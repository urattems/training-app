import type { z } from 'zod';
import { strings } from '../i18n/strings';

export type ImportErrorKind =
  | 'unreadable_file'
  | 'invalid_json'
  | 'wrong_type'
  | 'unsupported_version'
  | 'invalid_schema'
  | 'invariant'
  | 'duplicate_program';

/** Échec d'import/restauration : message humain + détails techniques optionnels. */
export interface ImportFailure {
  kind: ImportErrorKind;
  message: string;
  details: string[];
}

export type DocumentKind = 'program' | 'history' | 'coach';

const PREFIXES: Record<DocumentKind, string> = {
  program: strings.import.programPrefix,
  history: strings.import.restorePrefix,
  coach: strings.import.coachPrefix,
};

const prefixFor = (doc: DocumentKind): string => PREFIXES[doc];

export function importFailure(kind: ImportErrorKind, doc: DocumentKind, reason: string, details: string[] = []): ImportFailure {
  return { kind, message: `${prefixFor(doc)} : ${reason}`, details };
}

// --- Libellés de champs -----------------------------------------------------

const FIELD_LABELS: Record<string, string> = {
  schemaVersion: 'version du schéma',
  type: 'type',
  programId: 'identifiant du programme',
  name: 'nom',
  locale: 'langue',
  unitSystem: "système d'unités",
  createdAt: 'date de création',
  week: 'semaine',
  id: 'identifiant',
  label: 'libellé',
  startDate: 'date de début',
  endDate: 'date de fin',
  sessions: 'séances',
  order: 'ordre',
  estimatedDurationMin: 'durée estimée',
  exercises: 'exercices',
  cardio: 'cardio',
  category: 'catégorie',
  equipment: 'équipement',
  restSec: 'repos',
  notes: 'notes',
  sets: 'séries',
  setNumber: 'numéro de série',
  targetReps: 'répétitions cibles',
  targetRepsMin: 'répétitions cibles minimum',
  targetRepsMax: 'répétitions cibles maximum',
  targetWeightKg: 'charge cible',
  enabled: 'activation',
  targetDurationMin: 'durée cible',
  selection: 'sélection',
  mode: 'mode de sélection',
  sessionCount: 'nombre de séances',
  totalExportableSessions: 'nombre de séances exportables',
  firstSessionDate: 'date de la première séance',
  lastSessionDate: 'date de la dernière séance',
  exportedAt: "date d'export",
  activeProgramId: 'programme actif',
  preferences: 'préférences',
  unit: 'unité',
  theme: 'thème',
  programs: 'programmes',
  programSessionId: 'séance du programme',
  sessionName: 'nom de la séance',
  date: 'date',
  startedAt: 'début',
  completedAt: 'fin',
  durationSec: 'durée',
  status: 'statut',
  executionOrder: "ordre d'exécution",
  exerciseRecords: 'exercices réalisés',
  cardioRecords: 'cardio réalisé',
  exerciseId: "identifiant d'exercice",
  exerciseName: "nom d'exercice",
  programExerciseId: "identifiant d'exercice du programme",
  targetSets: 'objectifs',
  actualSets: 'séries réalisées',
  sensation: 'sensation',
  comment: 'commentaire',
  actualReps: 'répétitions',
  actualWeightKg: 'charge',
  isExtra: 'série en plus',
  speedKmh: 'vitesse',
  inclinePct: 'inclinaison',
};

const labelOf = (key: PropertyKey): string =>
  typeof key === 'string' ? (FIELD_LABELS[key] ?? key) : `élément n°${String(Number(key) + 1)}`;

// --- Description d'un chemin -----------------------------------------------

interface Segment {
  /** Forme définie : « la séance A ». */
  definite: string;
  /** Forme indéfinie : « une séance ». */
  indefinite: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

const asText = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);
const asNumber = (v: unknown): number | null => (typeof v === 'number' ? v : null);

function getAt(root: unknown, path: readonly PropertyKey[]): unknown {
  let current: unknown = root;
  for (const key of path) {
    if (Array.isArray(current) && typeof key === 'number') current = current[key];
    else if (isRecord(current) && typeof key === 'string') current = current[key];
    else return undefined;
  }
  return current;
}

/** Décrit l'élément `arrayKey[index]` à partir de sa valeur brute. */
function describeItem(arrayKey: string, index: number, item: unknown): Segment {
  const obj = isRecord(item) ? item : {};
  const nth = `n°${index + 1}`;
  switch (arrayKey) {
    case 'sessions': {
      const label = asText(obj.id) ?? nth;
      return { definite: `la séance ${label}`, indefinite: 'une séance' };
    }
    case 'exercises': {
      const label = asText(obj.name) ?? asText(obj.id);
      return { definite: label ? `l'exercice « ${label} »` : `l'exercice ${nth}`, indefinite: 'un exercice' };
    }
    case 'exerciseRecords': {
      const label = asText(obj.exerciseName) ?? asText(obj.programExerciseId);
      return { definite: label ? `l'exercice « ${label} »` : `l'exercice ${nth}`, indefinite: 'un exercice' };
    }
    case 'sets':
    case 'targetSets': {
      const n = asNumber(obj.setNumber) ?? index + 1;
      return {
        definite: arrayKey === 'sets' ? `la série ${n}` : `l'objectif de la série ${n}`,
        indefinite: arrayKey === 'sets' ? 'une série' : 'un objectif de série',
      };
    }
    case 'actualSets': {
      const n = asNumber(obj.setNumber) ?? index + 1;
      return { definite: `la série réalisée ${n}`, indefinite: 'une série réalisée' };
    }
    case 'cardioRecords':
      return { definite: `l'entrée cardio ${nth}`, indefinite: 'une entrée cardio' };
    case 'programs': {
      const label = asText(obj.programId) ?? nth;
      return { definite: `le programme « ${label} »`, indefinite: 'un programme' };
    }
    default:
      return { definite: `l'élément ${nth} de « ${labelOf(arrayKey)} »`, indefinite: 'un élément' };
  }
}

/** Liste les éléments de tableau traversés par le chemin, du plus externe au plus interne. */
function collectSegments(root: unknown, path: readonly PropertyKey[]): { segment: Segment; endsAt: number }[] {
  const segments: { segment: Segment; endsAt: number }[] = [];
  for (let i = 1; i < path.length; i++) {
    const key = path[i];
    const arrayKey = path[i - 1];
    if (typeof key === 'number' && typeof arrayKey === 'string') {
      segments.push({ segment: describeItem(arrayKey, key, getAt(root, path.slice(0, i + 1))), endsAt: i });
    }
  }
  return segments;
}

/** « l'exercice « X » de la séance A » */
const chain = (segments: { segment: Segment }[]): string =>
  segments
    .map((s) => s.segment.definite)
    .reverse()
    .join(' de ');

const ROOT_NOUNS: Record<DocumentKind, string> = { program: 'le programme', history: 'la sauvegarde', coach: "l'export pour le coach" };

const rootNoun = (doc: DocumentKind): string => ROOT_NOUNS[doc];

const FORMAT_HINTS: Record<string, string> = {
  datetime: 'date-heure ISO attendue, ex. 2026-10-01T18:00:00+02:00',
  date: 'date attendue au format AAAA-MM-JJ',
};

const EXPECTED_TYPES: Record<string, string> = {
  string: 'texte attendu',
  number: 'nombre attendu',
  int: 'nombre entier attendu',
  boolean: 'vrai/faux attendu',
  array: 'liste attendue',
  object: 'objet attendu',
};

function reasonOf(issue: z.core.$ZodIssue): string {
  switch (issue.code) {
    case 'invalid_type':
      return EXPECTED_TYPES[issue.expected] ?? `type attendu : ${issue.expected}`;
    case 'too_small':
      if (issue.origin === 'array') return `au moins ${String(issue.minimum)} élément(s) requis`;
      if (issue.origin === 'string') return 'ne peut pas être vide';
      return Number(issue.minimum) === 0 ? 'valeur négative interdite' : `minimum ${String(issue.minimum)}`;
    case 'too_big':
      return `maximum ${String(issue.maximum)}`;
    case 'invalid_value':
      return `valeur acceptée : ${issue.values.map((v) => `« ${String(v)} »`).join(', ')}`;
    case 'invalid_format':
      return FORMAT_HINTS[issue.format] ?? `format attendu : ${issue.format}`;
    case 'custom':
      return issue.message;
    default:
      return 'valeur invalide';
  }
}

/** Traduit une erreur Zod en phrase lisible, ex. « la séance A contient un exercice sans identifiant ». */
export function describeIssue(issue: z.core.$ZodIssue, root: unknown, doc: DocumentKind): string {
  const path = issue.path;
  const lastKey = path[path.length - 1];
  const parentPath = path.slice(0, -1);
  const parent = getAt(root, parentPath);
  const value = getAt(root, path);
  const segments = collectSegments(root, path);

  // Champ manquant dans un objet existant.
  const isMissing =
    issue.code === 'invalid_type' && value === undefined && typeof lastKey === 'string' && isRecord(parent);

  if (isMissing) {
    const label = labelOf(lastKey);
    const owner = segments[segments.length - 1];
    // Le propriétaire du champ est un élément de liste : « X contient un Y sans Z ».
    if (owner && owner.endsAt === path.length - 2) {
      const container = segments.slice(0, -1);
      const where = container.length > 0 ? chain(container) : rootNoun(doc);
      return `${where} contient ${owner.segment.indefinite} sans ${label}.`;
    }
    const where = segments.length > 0 ? `${chain(segments)} : ` : '';
    const parentKey = parentPath[parentPath.length - 1];
    const context = typeof parentKey === 'string' ? ` dans « ${labelOf(parentKey)} »` : '';
    return `${where}champ obligatoire « ${label} » manquant${context}.`;
  }

  const reason = reasonOf(issue);
  if (issue.code === 'custom') {
    const where = segments.length > 0 ? chain(segments) : rootNoun(doc);
    return `${where} : ${reason}.`;
  }
  const label = lastKey === undefined ? rootNoun(doc) : labelOf(lastKey);
  const ownSegments = typeof lastKey === 'number' ? segments.slice(0, -1) : segments;
  const where = ownSegments.length > 0 ? `${chain(ownSegments)} : ` : '';
  return `${where}${label} invalide (${reason}).`;
}

const technicalLine = (issue: z.core.$ZodIssue): string =>
  `${issue.path.map(String).join('.') || '(racine)'} — ${issue.code} : ${issue.message}`;

/** Construit l'échec d'import à partir des erreurs Zod : la première est détaillée, les autres comptées. */
export function zodFailure(error: z.ZodError, root: unknown, doc: DocumentKind): ImportFailure {
  const issues = error.issues;
  const first = issues[0];
  const main = first ? describeIssue(first, root, doc) : 'données invalides.';
  const more = issues.length > 1 ? ` ${strings.import.moreErrors(issues.length - 1)}` : '';
  // Le message suit « Import impossible : » : minuscule initiale conservée (exemple SPEC §10.1).
  return importFailure('invalid_schema', doc, main + more, issues.map(technicalLine));
}
