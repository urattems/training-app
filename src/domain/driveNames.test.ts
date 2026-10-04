import { afterEach, describe, expect, it } from 'vitest';
import { parseHistoryJson } from '../schemas/parse';
import { TEST_TIME_ZONE } from '../test/globalSetup';
import { readFixture } from '../test/fixtures';
import {
  alnumPrefix,
  cleanFolderName,
  cleanSessionName,
  maskSecret,
  maskUrl,
  redact,
  sameWeekLabel,
  sessionDriveName,
  sessionFileName,
  weekFolderName,
} from './driveNames';
import type { WorkoutSession } from './types';

const history = (() => {
  const parsed = parseHistoryJson(readFixture('history-example.json'));
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed.value;
})();
const session = history.sessions[0] as WorkoutSession;
const program = (id: string, label: string, createdAt: string) => ({ programId: id, createdAt, week: { id: 'w', label, startDate: null, endDate: null } });

describe('Dossier de semaine', () => {
  it('nettoyage : caractères interdits et de contrôle → -, espaces réduits, 120 caractères', () => {
    expect(cleanFolderName('Semaine 40')).toBe('Semaine 40');
    expect(cleanFolderName('  S40 : bloc "force" / A|B?  ')).toBe('S40 - bloc -force- - A-B-');
    // Tabulation et retour à la ligne sont des caractères de contrôle : remplacés par « - » aussi.
    expect(cleanFolderName('a\u0001b\tc\n\nd')).toBe('a-b-c--d');
    expect(cleanFolderName('a   b')).toBe('a b');
    expect(cleanFolderName('x'.repeat(200))).toHaveLength(120);
    expect(cleanFolderName('   ')).toBe('Sans semaine');
  });

  it('libellés en double : tous sauf le plus ancien (createdAt puis programId) reçoivent « (programId complet) »', () => {
    const programs = [
      program('prog-b7c2-w40', 'Semaine 40', '2026-10-01T08:00:00+02:00'),
      program('prog-a1-w40', ' semaine 40 ', '2026-09-28T08:00:00+02:00'),
      program('prog-c-w40', 'SEMAINE 40', '2026-10-01T08:00:00+02:00'),
      program('prog-w41', 'Semaine 41', '2026-10-05T08:00:00+02:00'),
    ];
    expect(weekFolderName(programs, 'prog-a1-w40')).toBe('semaine 40');
    // Règle fix-v1.3a : le programId COMPLET, unique, donc jamais deux doublons dans le même dossier.
    expect(weekFolderName(programs, 'prog-b7c2-w40')).toBe('Semaine 40 (prog-b7c2-w40)');
    expect(weekFolderName(programs, 'prog-c-w40')).toBe('SEMAINE 40 (prog-c-w40)');
    expect(weekFolderName(programs, 'prog-w41')).toBe('Semaine 41');
    // Déterministe : l'ordre de la liste (ou d'import) ne change rien.
    expect(weekFolderName([...programs].reverse(), 'prog-a1-w40')).toBe('semaine 40');
    expect(weekFolderName([...programs].reverse(), 'prog-b7c2-w40')).toBe('Semaine 40 (prog-b7c2-w40)');
    expect(sameWeekLabel(programs, programs[0] ?? program('', '', '')).map((p) => p.programId)).toEqual(['prog-a1-w40', 'prog-c-w40']);
  });

  it('aucune collision : des identifiants proches (prog-2026-w40, prog-2026-w40b) donnent des dossiers distincts', () => {
    const programs = [
      program('prog-2026-w40', 'Semaine 40', '2026-09-28T08:00:00+02:00'),
      program('prog-2026-w40b', 'Semaine 40', '2026-10-01T08:00:00+02:00'),
      program('prog-2026-w40c', 'Semaine 40', '2026-10-02T08:00:00+02:00'),
    ];
    const folders = programs.map((p) => weekFolderName(programs, p.programId));
    expect(folders).toEqual(['Semaine 40', 'Semaine 40 (prog-2026-w40b)', 'Semaine 40 (prog-2026-w40c)']);
    expect(new Set(folders).size).toBe(3);
  });

  it('programId nettoyé (mêmes règles que le libellé) ; au-delà de 120 caractères, seul le libellé est tronqué', () => {
    const odd = [program('a', 'S40', '2026-09-01T08:00:00+02:00'), program('id/avec:interdits', 'S40', '2026-09-02T08:00:00+02:00')];
    expect(weekFolderName(odd, 'id/avec:interdits')).toBe('S40 (id-avec-interdits)');
    const longLabel = 'Semaine '.repeat(30);
    const long = [program('first', longLabel, '2026-09-01T08:00:00+02:00'), program('prog-2026-w40', longLabel, '2026-09-02T08:00:00+02:00')];
    const folder = weekFolderName(long, 'prog-2026-w40');
    // Le libellé tronqué perd son espace final au nettoyage : au plus 120 caractères.
    expect(folder.length).toBeLessThanOrEqual(120);
    expect(folder.length).toBeGreaterThan(110);
    expect(folder.endsWith(' (prog-2026-w40)')).toBe(true);
    expect(longLabel.startsWith(folder.slice(0, -' (prog-2026-w40)'.length))).toBe(true);
    expect(weekFolderName(long, 'first').length).toBeLessThanOrEqual(120);
  });

  it('après restauration : mêmes noms (calculés depuis createdAt, jamais importedAt)', () => {
    const before = history.programs.map((p) => ({ ...p, importedAt: '2026-09-01T10:00:00+02:00' }));
    const restored = history.programs.map((p) => ({ ...p, importedAt: '2027-01-15T10:00:00+01:00' }));
    expect(weekFolderName(restored, 'prog-demo-w37')).toBe(weekFolderName(before, 'prog-demo-w37'));
  });

  it('programme inconnu : dossier de repli', () => {
    expect(weekFolderName([], 'x')).toBe('Sans semaine');
  });
});

describe('Fichier de séance', () => {
  it('AAAA-MM-JJ_HHmm_<Nom-sans-accents>_<id6>.json', () => {
    expect(sessionFileName({ id: 'ab-12-cd-34', date: '2026-10-04', startedAt: '2026-10-04T18:10:00+02:00', sessionName: 'Séance A' })).toBe(
      '2026-10-04_1810_Seance-A_ab12cd.json',
    );
  });

  it('accents, espaces multiples et caractères interdits', () => {
    expect(cleanSessionName('Épaules & dos : écart  « forcé »')).toBe('Epaules-&-dos-ecart-«-force-»');
    expect(cleanSessionName('Haut/Bas*?')).toBe('Haut-Bas');
    expect(cleanSessionName('   ')).toBe('Seance');
    expect(alnumPrefix('w-0001', 6)).toBe('w0001');
  });

  it('dossier + nom depuis les données de la fixture', () => {
    expect(sessionDriveName(history.programs, session)).toEqual({ folder: 'Semaine 37', name: '2026-09-08_1800_Seance-A_w0001.json' });
  });
});

describe('Fuseaux horaires : HHmm et date ne dépendent pas du fuseau de l’appareil', () => {
  afterEach(() => {
    process.env.TZ = TEST_TIME_ZONE;
  });

  it.each(['UTC', 'Europe/Paris', 'America/Los_Angeles', 'Pacific/Kiritimati'])('%s', (tz) => {
    process.env.TZ = tz;
    // 23:40 à Paris = 21:40 UTC : le nom garde la date de la séance et l'heure écrite (23:40).
    expect(sessionFileName({ id: 'w-0042', date: '2026-10-04', startedAt: '2026-10-04T23:40:00+02:00', sessionName: 'Séance B' })).toBe(
      '2026-10-04_2340_Seance-B_w0042.json',
    );
  });
});

describe('Masquage : jamais l’URL complète ni le secret', () => {
  const config = { url: 'https://script.google.com/macros/s/AKfycbSECRETSCRIPTID/exec', secret: 'mon-secret-tres-long-9876' };

  it('URL : segment /s/[…]/ ; secret : 4 derniers caractères', () => {
    expect(maskUrl(config.url)).toBe('https://script.google.com/macros/s/[…]/exec');
    expect(maskSecret(config.secret)).toBe('••••9876');
  });

  it('redact : retire secret et identifiant du script de tout texte', () => {
    const text = `TypeError at ${config.url}?x=1 body={"secret":"${config.secret}"} other https://x.dev/s/OTHERID/y`;
    const out = redact(text, config);
    expect(out).not.toContain(config.secret);
    expect(out).not.toContain('AKfycbSECRETSCRIPTID');
    expect(out).not.toContain('OTHERID');
    expect(out).toContain('[secret]');
  });
});
