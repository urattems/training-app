// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../app/App';
import { db } from '../../db/database';
import { parseHistoryJson } from '../../schemas/parse';
import { prepareExport } from '../../services/exportService';
import { previewRestore, restoreBackup } from '../../services/importService';
import { getLastExportAt, setLastExportAt } from '../../services/settingsService';
import { startWorkout } from '../../services/workoutService';
import { canonicalJson } from '../../utils/canonicalJson';
import { dumpDatabase, fixtureObject, readFixture, resetDatabase } from '../../test/fixtures';

/** Blobs remis au téléchargement (jsdom n'a pas URL.createObjectURL). */
let downloaded: Blob[] = [];
let failDownload = false;

function stubDownload() {
  downloaded = [];
  failDownload = false;
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: (blob: Blob) => {
      if (failDownload) throw new TypeError('createObjectURL indisponible');
      downloaded.push(blob);
      return 'blob:test';
    },
  });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: () => undefined });
}

async function restoreText(text: string) {
  const preview = previewRestore(text);
  if (!preview.ok) throw new Error(preview.error.message);
  await restoreBackup(preview.value.data);
}

function renderAt(hash: string) {
  window.location.hash = hash;
  const user = userEvent.setup();
  render(<App />);
  return user;
}

const backupFile = (text: string) => new File([text], 'training-backup.json', { type: 'application/json' });

beforeEach(async () => {
  // Seul Date est simulé : « aujourd'hui » = 20 octobre 2026.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 20, 12, 0, 0));
  stubDownload();
  await resetDatabase();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Paramètres — sections', () => {
  it('Données, Préférences (kg, clair, sans sélecteur), Informations (version, stockage)', async () => {
    renderAt('#/settings');
    expect(await screen.findByRole('button', { name: 'Exporter mes données' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Restaurer une sauvegarde' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Importer un programme' })).toBeInTheDocument();
    expect(screen.getByText('Kilogrammes (kg)')).toBeInTheDocument();
    expect(screen.getByText('Clair')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    // jsdom n'a pas navigator.storage (comme Safari en HTTP sur IP locale).
    expect(await screen.findByText('indisponible')).toBeInTheDocument();
    expect(screen.getByText('Aucun export pour l’instant.')).toBeInTheDocument();
  });
});

describe('Export (repli téléchargement, chemin fiable en HTTP local)', () => {
  it('télécharge training-backup-AAAA-MM-JJ.json, ré-restaurable à l\'identique, et mémorise la date', async () => {
    await restoreText(readFixture('history-example.json'));
    const user = renderAt('#/settings');
    expect(await screen.findByText(/1 programme et 3 séances/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Exporter mes données' }));

    expect(await screen.findByText('Fichier téléchargé : training-backup-2026-10-20.json')).toBeInTheDocument();
    expect(downloaded).toHaveLength(1);
    const text = await (downloaded[0] as Blob).text();
    const parsed = parseHistoryJson(text);
    expect(parsed.ok).toBe(true);
    const fixture = parseHistoryJson(readFixture('history-example.json'));
    if (!parsed.ok || !fixture.ok) throw new Error();
    expect(canonicalJson({ ...parsed.value, exportedAt: '' })).toBe(canonicalJson({ ...fixture.value, exportedAt: '' }));

    expect(await getLastExportAt()).toBe(parsed.value.exportedAt);
    expect(await screen.findByText(/^Dernier export : mardi 20 octobre à 12:00/)).toBeInTheDocument();
  });

  it('échec du téléchargement : message + détails, lastExportAt non écrit', async () => {
    await restoreText(readFixture('history-example.json'));
    failDownload = true;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const user = renderAt('#/settings');
    await screen.findByText(/1 programme et 3 séances/);
    await user.click(screen.getByRole('button', { name: 'Exporter mes données' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('L’export n’a pas pu être effectué');
    await user.click(within(alert).getByRole('button', { name: 'Afficher les détails' }));
    expect(within(alert).getByText('TypeError: createObjectURL indisponible')).toBeInTheDocument();
    expect(await getLastExportAt()).toBeNull();
  });
});

describe('Restauration', () => {
  it('résumé, export des données actuelles obligatoire, puis restauration (+ copie interne)', async () => {
    // Données actuelles : un programme importé.
    const other = fixtureObject('history-example.json');
    other.sessions = [];
    await restoreText(JSON.stringify(other));
    const previous = await prepareExport();

    const user = renderAt('#/settings');
    await screen.findByText(/1 programme et 0 séance/);
    await user.upload(screen.getByLabelText('Choisir un fichier de sauvegarde (.json)'), backupFile(readFixture('history-example.json')));

    const dialog = await screen.findByRole('dialog', { name: 'Restaurer cette sauvegarde ?' });
    expect(within(dialog).getByText('Date d’export').nextElementSibling).toHaveTextContent('jeudi 1 octobre à 18:45');
    expect(within(dialog).getByText('Version du schéma').nextElementSibling).toHaveTextContent('1.0');
    expect(within(dialog).getByText('Programmes').nextElementSibling).toHaveTextContent('1');
    expect(within(dialog).getByText('Séances').nextElementSibling).toHaveTextContent('3');
    const restore = within(dialog).getByRole('button', { name: 'Restaurer' });
    expect(restore).toBeDisabled();
    expect(within(dialog).getByText('Exporte d’abord tes données actuelles pour activer la restauration.')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Exporter mes données actuelles' }));
    expect(await within(dialog).findByText('Données actuelles exportées.')).toBeInTheDocument();
    expect(downloaded).toHaveLength(1);
    expect(restore).toBeEnabled();

    await user.click(restore);
    const success = await screen.findByRole('dialog', { name: 'Sauvegarde restaurée' });
    expect(success).toHaveTextContent('1 programme et 3 séances restaurés.');
    expect(await db.workouts.count()).toBe(3);
    const backup = await db.metadata.get('preRestoreBackup');
    expect(backup?.data.programs).toEqual(previous.data.programs);

    await user.click(within(success).getByRole('button', { name: 'Continuer' }));
    expect(window.location.hash).toBe('#/');
  });

  it('base vide (nouvel appareil) : rien à sauvegarder, Restaurer actif directement', async () => {
    const user = renderAt('#/settings');
    await screen.findByText(/0 programme et 0 séance/);
    await user.upload(screen.getByLabelText('Choisir un fichier de sauvegarde (.json)'), backupFile(readFixture('history-example.json')));
    const dialog = await screen.findByRole('dialog', { name: 'Restaurer cette sauvegarde ?' });
    expect(within(dialog).getByText('Aucune donnée actuelle : rien à sauvegarder avant la restauration.')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Restaurer' }));
    expect(await screen.findByRole('dialog', { name: 'Sauvegarde restaurée' })).toBeInTheDocument();
    expect(await db.workouts.count()).toBe(3);
  });

  it.each([
    ['JSON illisible', 'pas du json', 'le fichier n\'est pas un JSON valide'],
    ['programme à la place d\'une sauvegarde', readFixture('program-example.json'), 'ce fichier n\'est pas une sauvegarde'],
    [
      'activeProgramId inconnu',
      JSON.stringify({ ...fixtureObject('history-example.json'), activeProgramId: 'fantome' }),
      'le programme actif « fantome »',
    ],
  ])('fichier refusé (%s) : message français, rien n\'est écrit', async (_, text, message) => {
    await restoreText(readFixture('history-example.json'));
    const before = await dumpDatabase();
    const user = renderAt('#/settings');
    await screen.findByText(/1 programme et 3 séances/);
    await user.upload(screen.getByLabelText('Choisir un fichier de sauvegarde (.json)'), backupFile(text));
    const dialog = await screen.findByRole('dialog', { name: 'Fichier refusé' });
    expect(within(dialog).getByRole('alert')).toHaveTextContent(`Restauration impossible : ${message}`);
    expect(await dumpDatabase()).toEqual(before);
  });

  it('échec pendant la restauration : message + détails, aucune donnée modifiée', async () => {
    const user = renderAt('#/settings');
    await screen.findByText(/0 programme et 0 séance/);
    const before = await dumpDatabase();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(db.workouts, 'bulkPut').mockRejectedValueOnce(new Error('disque plein'));
    await user.upload(screen.getByLabelText('Choisir un fichier de sauvegarde (.json)'), backupFile(readFixture('history-example.json')));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Restaurer' }));
    const dialog = await screen.findByRole('dialog', { name: 'Restauration impossible' });
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Aucune donnée n’a été modifiée.');
    await user.click(within(dialog).getByRole('button', { name: 'Afficher les détails' }));
    expect(within(dialog).getByText('Error: disque plein')).toBeInTheDocument();
    expect(await dumpDatabase()).toEqual(before);
  });
});

describe('Rappel d\'export sur l\'accueil (date figée : 20 octobre 2026)', () => {
  it('jamais exporté + séances terminées → bandeau discret', async () => {
    await restoreText(readFixture('history-example.json'));
    const user = renderAt('#/');
    const note = await screen.findByRole('note');
    expect(note).toHaveTextContent('Tes séances ne sont enregistrées que sur cet appareil.');
    await user.click(within(note).getByRole('link', { name: 'Exporter' }));
    expect(window.location.hash).toBe('#/settings');
  });

  it('export ancien (> 14 jours) avec séance terminée depuis → « il y a N jours »', async () => {
    await restoreText(readFixture('history-example.json'));
    await setLastExportAt('2026-09-10T08:00:00+02:00');
    renderAt('#/');
    expect(await screen.findByRole('note')).toHaveTextContent('Dernier export il y a 40 jours.');
  });

  it('export récent → pas de bandeau', async () => {
    await restoreText(readFixture('history-example.json'));
    await setLastExportAt('2026-10-15T08:00:00+02:00');
    renderAt('#/');
    await screen.findByRole('button', { name: 'Commencer la séance' });
    await waitFor(() => {
      expect(screen.queryByRole('note')).not.toBeInTheDocument();
    });
  });

  it('jamais pendant une séance en cours', async () => {
    await restoreText(readFixture('history-example.json'));
    await startWorkout('A');
    renderAt('#/');
    await screen.findByRole('heading', { name: 'Séance A en cours' });
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });
});
