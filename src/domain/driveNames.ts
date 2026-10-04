/**
 * Noms de l'archive Drive (V1.3, spec §4), règles pures et déterministes.
 * Les noms sont calculés depuis les données EXPORTABLES (programmes, séance), donc identiques
 * après une restauration ; ils sont gelés au premier envoi (cf. services/driveOutbox).
 */
import type { TrainingProgram, WorkoutSession } from './types';

/** Mêmes règles que le script : `\ / : * ? " < > |` et caractères de contrôle → `-`. */
// eslint-disable-next-line no-control-regex -- les caractères de contrôle sont précisément visés
const FORBIDDEN = /[\\/:*?"<>|\u0000-\u001f\u007f]/g;
const MAX_FOLDER_LENGTH = 120;
const FALLBACK_FOLDER = 'Sans semaine';
const FALLBACK_SESSION = 'Seance';

/** Nettoyage du script : interdits et caractères de contrôle → `-`, espaces réduits. */
const cleanText = (text: string): string => text.replace(FORBIDDEN, '-').replace(/\s+/g, ' ').trim();

/** Libellé nettoyé pour un nom de dossier : interdits → `-`, espaces réduits, 120 caractères max. */
export function cleanFolderName(label: string, maxLength: number = MAX_FOLDER_LENGTH): string {
  const cleaned = cleanText(label).slice(0, Math.max(0, maxLength)).trim();
  return cleaned === '' ? FALLBACK_FOLDER : cleaned;
}

/** Comparaison des libellés : sans casse ni espaces autour. */
const labelKey = (label: string): string => label.trim().toLocaleLowerCase('fr-FR');

/** Les `n` premiers caractères alphanumériques (ASCII) d'un identifiant. */
export const alnumPrefix = (id: string, n: number): string => id.replace(/[^A-Za-z0-9]/g, '').slice(0, n);

type ProgramLike = Pick<TrainingProgram, 'programId' | 'createdAt' | 'week'>;

/** Plus ancien d'abord : `createdAt`, puis `programId` (déterministe). */
const byAge = (a: ProgramLike, b: ProgramLike): number => {
  const t = Date.parse(a.createdAt) - Date.parse(b.createdAt);
  if (t !== 0) return t;
  return a.programId < b.programId ? -1 : a.programId > b.programId ? 1 : 0;
};

/**
 * Dossier de semaine d'un programme. Si plusieurs programmes partagent le même libellé, tous
 * sauf le plus ancien (createdAt, puis programId) reçoivent le suffixe ` (<programId complet
 * nettoyé>)`. Le programId est unique (l'import refuse les doublons) : aucune collision.
 * Au-delà de 120 caractères, c'est le LIBELLÉ qui est tronqué, jamais le programId.
 */
export function weekFolderName(programs: readonly ProgramLike[], programId: string): string {
  const program = programs.find((p) => p.programId === programId);
  if (!program) return FALLBACK_FOLDER;
  const oldest = programs.filter((p) => labelKey(p.week.label) === labelKey(program.week.label)).sort(byAge)[0];
  if (oldest === undefined || oldest.programId === program.programId) return cleanFolderName(program.week.label);
  const suffix = ` (${cleanText(program.programId)})`;
  return `${cleanFolderName(program.week.label, MAX_FOLDER_LENGTH - suffix.length)}${suffix}`;
}

/** Programmes existants qui partagent le libellé de semaine d'un programme (alerte d'import). */
export const sameWeekLabel = (programs: readonly ProgramLike[], program: ProgramLike): ProgramLike[] =>
  programs.filter((p) => p.programId !== program.programId && labelKey(p.week.label) === labelKey(program.week.label));

/** Nom de séance pour un fichier : sans accents, espaces et interdits → `-`. */
export function cleanSessionName(name: string): string {
  const cleaned = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(FORBIDDEN, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return cleaned === '' ? FALLBACK_SESSION : cleaned;
}

/**
 * Heure `HHmm` de `startedAt` telle qu'écrite dans l'horodatage (heure locale AU MOMENT de la
 * séance, offset compris) : le nom ne dépend pas du fuseau de l'appareil au moment de l'envoi.
 */
export function startedAtHHmm(startedAt: string): string {
  const match = /T(\d{2}):(\d{2})/.exec(startedAt);
  return match ? `${match[1] ?? '00'}${match[2] ?? '00'}` : '0000';
}

/** `AAAA-MM-JJ_HHmm_<Nom-sans-accents>_<id6>.json` (spec §4). */
export function sessionFileName(session: Pick<WorkoutSession, 'id' | 'date' | 'startedAt' | 'sessionName'>): string {
  return `${session.date}_${startedAtHHmm(session.startedAt)}_${cleanSessionName(session.sessionName)}_${alnumPrefix(session.id, 6)}.json`;
}

export interface DriveFileName {
  folder: string;
  name: string;
}

/** Dossier + nom d'une séance (avant gel). */
export function sessionDriveName(programs: readonly ProgramLike[], session: WorkoutSession): DriveFileName {
  return { folder: weekFolderName(programs, session.programId), name: sessionFileName(session) };
}

// --- Masquage ----------------------------------------------------------------------

/** URL affichable : l'identifiant du script (`/s/…/`) n'apparaît jamais. */
export function maskUrl(url: string): string {
  return url.replace(/\/s\/[^/?#]+/g, '/s/[…]');
}

/** Secret affichable : seulement ses 4 derniers caractères. */
export function maskSecret(secret: string): string {
  return secret === '' ? '' : `••••${secret.slice(-4)}`;
}

/**
 * Retire d'un texte (détail technique, message d'erreur) toute trace du secret et de l'URL
 * complète. Appliqué à TOUT ce qui peut être affiché ou conservé.
 */
export function redact(text: string, config: { url: string; secret: string }): string {
  let out = text;
  if (config.secret.length >= 4) out = out.split(config.secret).join('[secret]');
  if (config.url !== '') out = out.split(config.url).join(maskUrl(config.url));
  return maskUrl(out);
}
