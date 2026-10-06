import { strings } from '../i18n/strings';
import type { CoachExport } from './coachExport.schema';
import type { HistoryExport } from './history.schema';
import { toLocalDateString } from '../utils/dates';

const findDuplicates = (values: readonly string[]): string[] => {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const v of values) {
    if (seen.has(v)) duplicates.add(v);
    seen.add(v);
  }
  return [...duplicates];
};

/**
 * Mensurations (V1.5.0) : une seule prise par date, jamais dans le futur. Les règles de valeur
 * (> 0, 1 décimale, ≤ 300 cm) et « au moins une mesure » sont portées par le schéma.
 */
export function checkMeasurementEntries(entries: readonly { date: string }[], today: string): string[] {
  const t = strings.invariants;
  const violations = findDuplicates(entries.map((e) => e.date)).map(t.duplicateMeasurementDate);
  for (const entry of entries) if (entry.date > today) violations.push(t.futureMeasurementDate(entry.date));
  return violations;
}

/**
 * Pesées (V1.2) : une par jour (dates uniques), jamais datée après aujourd'hui (date locale
 * de l'appareil). Format de date, poids et `recordedAt` sont déjà vérifiés par Zod.
 */
export function checkWeightEntries(entries: readonly { date: string }[], today: string): string[] {
  const t = strings.invariants;
  const violations = findDuplicates(entries.map((e) => e.date)).map(t.duplicateWeightDate);
  for (const entry of entries) if (entry.date > today) violations.push(t.futureWeightDate(entry.date));
  return violations;
}

/**
 * Invariants de cohérence d'une sauvegarde (SPEC §10.5), vérifiés après Zod.
 * Retourne la liste des violations (vide = fichier cohérent).
 */
export function checkHistoryInvariants(data: HistoryExport, today: string = toLocalDateString(new Date())): string[] {
  const t = strings.invariants;
  const violations = [...checkWeightEntries(data.weightEntries, today), ...checkMeasurementEntries(data.measurementEntries, today)];

  const programIds = data.programs.map((p) => p.programId);
  for (const id of findDuplicates(programIds)) violations.push(t.duplicateProgramId(id));
  for (const id of findDuplicates(data.sessions.map((s) => s.id))) violations.push(t.duplicateWorkoutId(id));

  const inProgress = data.sessions.filter((s) => s.status === 'in_progress');
  if (inProgress.length > 1) violations.push(t.severalInProgress(inProgress.map((s) => s.id).join(', ')));

  const known = new Set(programIds);
  if (data.activeProgramId !== null && !known.has(data.activeProgramId)) {
    violations.push(t.unknownActiveProgram(data.activeProgramId));
  }

  for (const session of data.sessions) {
    if (!known.has(session.programId)) violations.push(t.unknownProgram(session.id, session.programId));
    if (session.status === 'completed' && session.completedAt === null) violations.push(t.completedWithoutEnd(session.id));
    if (session.status === 'in_progress' && session.completedAt !== null) violations.push(t.inProgressWithEnd(session.id));
  }

  return violations;
}

/**
 * Invariants d'un export pour le coach (SPEC §10.6), vérifiés après Zod :
 * programmes référencés présents, identifiants uniques, aucune séance en cours,
 * `selection` cohérente avec `sessions` (nombre, dates, ordre chronologique).
 */
export function checkCoachExportInvariants(data: CoachExport): string[] {
  const t = strings.invariants;
  const violations: string[] = [];

  const programIds = data.programs.map((p) => p.programId);
  for (const id of findDuplicates(programIds)) violations.push(t.duplicateProgramId(id));
  for (const id of findDuplicates(data.sessions.map((s) => s.id))) violations.push(t.duplicateWorkoutId(id));

  const known = new Set(programIds);
  if (data.activeProgramId !== null && !known.has(data.activeProgramId)) {
    violations.push(t.unknownActiveProgram(data.activeProgramId));
  }
  for (const session of data.sessions) {
    if (!known.has(session.programId)) violations.push(t.unknownProgram(session.id, session.programId));
    if (session.status === 'in_progress') violations.push(t.coachInProgress(session.id));
    if (session.status === 'completed' && session.completedAt === null) violations.push(t.completedWithoutEnd(session.id));
  }

  const { selection, sessions } = data;
  if (selection.sessionCount !== sessions.length) violations.push(t.coachCountMismatch(selection.sessionCount, sessions.length));
  if (selection.totalExportableSessions < sessions.length) violations.push(t.coachTotalTooSmall(selection.totalExportableSessions));
  const sorted = sessions.every((s, i) => i === 0 || Date.parse(sessions[i - 1]?.startedAt ?? '') <= Date.parse(s.startedAt));
  if (!sorted) violations.push(t.coachNotChronological);
  if (selection.firstSessionDate !== sessions[0]?.date || selection.lastSessionDate !== sessions.at(-1)?.date) {
    violations.push(t.coachDatesMismatch);
  }

  // Pesées (1.1) : désactivées ⇒ aucune ; sinon dates uniques, croissantes, dans la fenêtre, compte exact.
  const { weightEntries, weightWindow } = data;
  if (weightWindow === null) {
    if (weightEntries.length > 0) violations.push(t.coachWeightsWithoutWindow);
    return violations;
  }
  if (weightWindow.from > weightWindow.to) violations.push(t.coachWeightWindowReversed);
  if (weightWindow.count !== weightEntries.length) violations.push(t.coachWeightCountMismatch(weightWindow.count, weightEntries.length));
  const increasing = weightEntries.every((e, i) => i === 0 || (weightEntries[i - 1]?.date ?? '') < e.date);
  if (!increasing) violations.push(t.coachWeightsNotIncreasing);
  for (const entry of weightEntries) {
    if (entry.date < weightWindow.from || entry.date > weightWindow.to) violations.push(t.coachWeightOutsideWindow(entry.date));
  }
  return violations;
}
