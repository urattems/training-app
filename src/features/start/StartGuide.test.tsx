// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../app/App';
import { COACH_GUIDE_URL, COACH_PROMPT } from '../../coach/coachPrompt';
import { db } from '../../db/database';
import { parseProgramJson } from '../../schemas/parse';
import { previewRestore, restoreBackup } from '../../services/importService';
import { importProgram } from '../../services/programService';
import { dumpDatabase, fixtureObject, readFixture, resetDatabase } from '../../test/fixtures';

/**
 * Écran de démarrage (V1.8-SPEC §4.1) et « Copier l'erreur pour mon coach » (§4.2), sur l'app
 * complète et la vraie base : affiché seulement quand la table `programs` est vide.
 */
const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as { version: string };
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';

const writeText = vi.fn<(text: string) => Promise<void>>();

function setUserAgent(ua: string) {
  Object.defineProperty(window.navigator, 'userAgent', { value: ua, configurable: true });
}

/** `display-mode: standalone` simulé (les autres requêtes restent fausses). */
function setDisplayModeStandalone(standalone: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: standalone && query === '(display-mode: standalone)',
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }));
}

function renderAt(hash: string) {
  window.location.hash = hash;
  const user = userEvent.setup();
  render(<App />);
  // Après userEvent.setup(), qui installe son propre presse-papiers.
  Object.defineProperty(window.navigator, 'clipboard', { value: { writeText, readText: vi.fn() }, configurable: true, writable: true });
  return user;
}

const restoreText = async (text: string) => {
  const preview = previewRestore(text);
  if (!preview.ok) throw new Error(preview.error.message);
  await restoreBackup(preview.value.data);
};

/** Sauvegarde 1.2 valide SANS aucun programme (une pesée seulement). */
const backupWithoutPrograms = JSON.stringify({
  schemaVersion: '1.2',
  type: 'training_history_export',
  exportedAt: '2026-10-01T18:45:00+02:00',
  locale: 'fr-FR',
  unitSystem: 'metric',
  activeProgramId: null,
  preferences: { unit: 'kg', theme: 'light' },
  programs: [],
  sessions: [],
  weightEntries: [{ date: '2026-09-30', weightKg: 80.5, recordedAt: '2026-09-30T07:30:00+02:00' }],
  measurementEntries: [],
});

const originalMatchMedia = window.matchMedia.bind(window);

beforeEach(async () => {
  await resetDatabase();
  writeText.mockReset();
  writeText.mockResolvedValue(undefined);
  setUserAgent(IPHONE_UA);
  setDisplayModeStandalone(false);
});

afterEach(() => {
  cleanup();
  window.matchMedia = originalMatchMedia;
  Reflect.deleteProperty(window.navigator, 'userAgent');
  Reflect.deleteProperty(window.navigator, 'standalone');
  vi.restoreAllMocks();
});

const startHeadings = () => screen.queryAllByRole('heading', { level: 2 }).map((h) => h.textContent);

describe('Affichage selon la table programs', () => {
  it('vide : écran de démarrage en 3 étapes, Bienvenue en tête, rien n’est écrit en base', async () => {
    renderAt('#/');
    expect(await screen.findByRole('heading', { name: 'Bienvenue' })).toBeInTheDocument();
    expect(startHeadings()).toEqual(['Bienvenue', '1. Installer l’app', '2. Démarrer ton coach', '3. Importer ton programme']);
    expect(await dumpDatabase()).toEqual({ programs: [], workouts: [], settings: [], metadata: [], weights: [], measurements: [] });
  });

  it('au moins un programme actif : aucun écran de démarrage (cas de l’utilisateur actuel)', async () => {
    const program = parseProgramJson(readFixture('program-example.json'));
    if (!program.ok) throw new Error('fixture');
    await importProgram(program.value);
    renderAt('#/');
    expect(await screen.findByRole('button', { name: 'Commencer la séance' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '2. Démarrer ton coach' })).not.toBeInTheDocument();
  });

  it('programmes archivés seulement (aucun actif) : aucun écran de démarrage', async () => {
    const history = fixtureObject('history-example.json');
    history.activeProgramId = null;
    await restoreText(JSON.stringify(history));
    expect(await db.programs.count()).toBeGreaterThan(0);
    renderAt('#/');
    expect(await screen.findByRole('heading', { name: 'Bienvenue' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '2. Démarrer ton coach' })).not.toBeInTheDocument();
  });

  it('après un import depuis l’écran de démarrage : l’écran disparaît, la prochaine séance s’affiche', async () => {
    const user = renderAt('#/');
    await screen.findByRole('heading', { name: '3. Importer ton programme' });
    await user.upload(screen.getByLabelText('Choisir un fichier programme (.json)'), new File([readFixture('program-example.json')], 'p.json', { type: 'application/json' }));
    await user.click(within(await screen.findByRole('dialog', { name: 'Importer ce programme ?' })).getByRole('button', { name: 'Importer' }));
    await user.click(within(await screen.findByRole('dialog', { name: 'Programme importé' })).getByRole('button', { name: 'Continuer' }));
    expect(await screen.findByRole('button', { name: 'Commencer la séance' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '3. Importer ton programme' })).not.toBeInTheDocument();
  });

  it('après restauration d’une sauvegarde AVEC programmes : aucun écran ; SANS programme : écran', async () => {
    await restoreText(readFixture('history-example.json'));
    renderAt('#/');
    expect(await screen.findByRole('button', { name: 'Commencer la séance' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '2. Démarrer ton coach' })).not.toBeInTheDocument();
    cleanup();

    await restoreText(backupWithoutPrograms);
    expect(await db.programs.count()).toBe(0);
    expect(await db.weights.count()).toBe(1);
    renderAt('#/');
    expect(await screen.findByRole('heading', { name: '2. Démarrer ton coach' })).toBeInTheDocument();
  });

  it('« Guide de démarrage » dans Paramètres rouvre le même écran, même avec un programme', async () => {
    await restoreText(readFixture('history-example.json'));
    const user = renderAt('#/settings');
    await user.click(await screen.findByRole('link', { name: 'Guide de démarrage' }));
    expect(window.location.hash).toBe('#/start');
    expect(await screen.findByRole('heading', { level: 1, name: 'Guide de démarrage' })).toBeInTheDocument();
    expect(startHeadings()).toEqual(['1. Installer l’app', '2. Démarrer ton coach', '3. Importer ton programme']);
    expect(screen.getByRole('link', { name: 'Paramètres' })).toHaveAttribute('href', '#/settings');
  });
});

describe('Étape 1 — Installer', () => {
  it('iPhone présélectionné sur iPhone, tutoriel Safari ; un tap passe à Android (choix non mémorisé)', async () => {
    const user = renderAt('#/');
    const group = await screen.findByRole('group', { name: 'Ton téléphone' });
    expect(within(group).getByRole('button', { name: 'iPhone' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(group).getByRole('button', { name: 'Android' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('list', { name: 'iPhone' })).toHaveTextContent('Ouvre cette page dans Safari.');
    expect(screen.getByRole('list', { name: 'iPhone' })).toHaveTextContent('Choisis « Sur l’écran d’accueil », puis Ajouter.');

    await user.click(within(group).getByRole('button', { name: 'Android' }));
    expect(within(group).getByRole('button', { name: 'Android' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('list', { name: 'Android' })).toHaveTextContent('Ouvre cette page dans Chrome.');
    expect(screen.getByRole('list', { name: 'Android' })).toHaveTextContent('Choisis « Installer l’application » (ou « Ajouter à l’écran d’accueil »).');
    expect(await dumpDatabase()).toMatchObject({ settings: [] });
  });

  it('Android présélectionné sur Android', async () => {
    setUserAgent(ANDROID_UA);
    renderAt('#/');
    const group = await screen.findByRole('group', { name: 'Ton téléphone' });
    expect(within(group).getByRole('button', { name: 'Android' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('list', { name: 'Android' })).toHaveTextContent('Touche le menu ⋮ (en haut à droite).');
  });

  it('masquée en mode installé (display-mode standalone) : les étapes sont renumérotées', async () => {
    setDisplayModeStandalone(true);
    renderAt('#/');
    await screen.findByRole('heading', { name: 'Bienvenue' });
    expect(startHeadings()).toEqual(['Bienvenue', '1. Démarrer ton coach', '2. Importer ton programme']);
    expect(screen.queryByRole('group', { name: 'Ton téléphone' })).not.toBeInTheDocument();
  });

  it('masquée en mode installé sur iOS (navigator.standalone)', async () => {
    Object.defineProperty(window.navigator, 'standalone', { value: true, configurable: true });
    renderAt('#/');
    await screen.findByRole('heading', { name: 'Bienvenue' });
    expect(screen.queryByRole('heading', { name: '1. Installer l’app' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '1. Démarrer ton coach' })).toBeInTheDocument();
  });
});

describe('Étape 2 — Démarrer ton coach', () => {
  it('« Copier le prompt du coach » : presse-papiers = COACH_PROMPT exactement, puis « Copié »', async () => {
    const user = renderAt('#/');
    await user.click(await screen.findByRole('button', { name: 'Copier le prompt du coach' }));
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(COACH_PROMPT);
    expect(writeText.mock.calls[0]?.[0]).toBe(
      "Sois mon coach de musculation pour l'app Training App. Lis d'abord le guide en entier, puis confirme que tu l'as lu ; si tu ne peux pas l'ouvrir, dis-le et je te le collerai. Ensuite, commence l'accueil. Le guide : https://raw.githubusercontent.com/urattems/training-app/main/public/coach.md",
    );
    expect(await screen.findByRole('status')).toHaveTextContent('Copié');
  });

  it('presse-papiers refusé : le prompt s’affiche, sélectionnable, sans « Copié »', async () => {
    writeText.mockRejectedValue(new DOMException('refusé', 'NotAllowedError'));
    const user = renderAt('#/');
    await user.click(await screen.findByRole('button', { name: 'Copier le prompt du coach' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Copie impossible sur cet appareil');
    const field = screen.getByLabelText('Texte à copier');
    expect(field).toHaveValue(COACH_PROMPT);
    expect(field).toHaveAttribute('readonly');
    expect(screen.queryByText('Copié')).not.toBeInTheDocument();
  });

  it('presse-papiers absent (HTTP local) : même repli', async () => {
    const user = renderAt('#/');
    Object.defineProperty(window.navigator, 'clipboard', { value: undefined, configurable: true, writable: true });
    await user.click(await screen.findByRole('button', { name: 'Copier le prompt du coach' }));
    expect(await screen.findByLabelText('Texte à copier')).toHaveValue(COACH_PROMPT);
  });

  it('lien vers le guide (nouvel onglet) et phrase vie privée du §7, telle quelle', async () => {
    renderAt('#/');
    const link = await screen.findByRole('link', { name: 'Ouvrir le guide du coach' });
    expect(link).toHaveAttribute('href', COACH_GUIDE_URL);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(
      screen.getByText(
        'Tes séances restent sur ton téléphone. Ce que tu envoies à ton IA (profil, exports) est traité par son fournisseur, selon ses conditions. Envoie seulement ce qui est utile.',
      ),
    ).toBeInTheDocument();
  });
});

describe('Étape 3 — Importer ton programme', () => {
  it('mène à l’import existant : « Coller le JSON » ouvre la feuille de collage habituelle', async () => {
    const user = renderAt('#/');
    await user.click(await screen.findByRole('button', { name: 'Coller le JSON' }));
    expect(await screen.findByRole('dialog', { name: 'Coller un programme' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Importer un programme JSON' })).toHaveLength(1);
  });
});

describe('« Copier l’erreur pour mon coach » (§4.2)', () => {
  it('programme refusé : le presse-papiers reçoit version, format attendu, message, erreurs et consigne', async () => {
    const program = fixtureObject('program-example.json');
    const exercise = ((program.sessions as Record<string, unknown>[])[0]?.exercises as Record<string, unknown>[])[1] ?? {};
    delete exercise.id;
    exercise.restSec = -5;
    const text = JSON.stringify(program);
    const parsed = parseProgramJson(text);
    if (parsed.ok) throw new Error('le programme devait être refusé');

    const user = renderAt('#/');
    await screen.findByRole('heading', { name: 'Bienvenue' });
    await user.upload(screen.getByLabelText('Choisir un fichier programme (.json)'), new File([text], 'p.json', { type: 'application/json' }));
    const dialog = await screen.findByRole('dialog', { name: 'Fichier refusé' });
    await user.click(within(dialog).getByRole('button', { name: 'Copier l’erreur pour mon coach' }));

    expect(parsed.error.details.length).toBe(2);
    expect(parsed.error.details.every((line) => /^sessions\.0\.exercises\.1\.(id|restSec) — /.test(line))).toBe(true);
    expect(writeText).toHaveBeenCalledWith(
      [
        `Erreur d'import d'un programme dans Training App (version ${pkg.version}).`,
        'Format attendu : "type": "training_program", "schemaVersion": "1.0".',
        '',
        `Message de l'app : ${parsed.error.message}`,
        '',
        'Erreurs (emplacement — détail) :',
        ...parsed.error.details.map((line) => `- ${line}`),
        '',
        'Corrige et renvoie le JSON complet, seul, conforme au guide du coach : https://raw.githubusercontent.com/urattems/training-app/main/public/coach.md',
      ].join('\n'),
    );
    expect(parsed.error.message).toBe('Import impossible : la séance A contient un exercice sans identifiant. (et 1 autre erreur)');
    expect(await within(dialog).findByRole('status')).toHaveTextContent('Copié');
    // Le message affiché et les détails à la demande sont inchangés.
    expect(within(dialog).getAllByRole('alert')[0]).toHaveTextContent(parsed.error.message);
    await waitFor(() => {
      expect(within(dialog).getByRole('button', { name: 'Afficher les détails' })).toBeInTheDocument();
    });
  });
});
