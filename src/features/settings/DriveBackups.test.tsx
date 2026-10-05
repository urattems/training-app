// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { computeAccessibleName } from 'dom-accessibility-api';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from '../../app/App';
import { createDriveClient, type FetchLike } from '../../services/driveClient';
import { enqueueDriveTask, getOutbox, processDriveOutbox, setDriveClient } from '../../services/driveOutbox';
import { markDriveTested, saveDriveConfig, setDriveEnabled } from '../../services/driveSettings';
import { previewRestore, restoreBackup } from '../../services/importService';
import { getLastAutoBackupAt, setLastExportAt, setLastWeeklyBackupAt } from '../../services/settingsService';
import { resetDatabase } from '../../test/fixtures';

const URL_ = 'https://script.google.com/macros/s/AKfycbUIBACKUPID/exec';
const SECRET = 'secret-ui-sauvegarde-1357';
const example = (name: string) => readFileSync(resolve(process.cwd(), 'examples', name), 'utf8');

interface Sent {
  action: string;
  name?: string;
  force?: boolean;
}
let sent: Sent[] = [];
let reply: (req: Sent) => Response | Error = () => new Response('{"ok":true,"version":"sync-2","rootReady":true}');
const fetch: FetchLike = (_url, init) => {
  const req = JSON.parse(init.body as string) as Sent;
  sent.push(req);
  const out = reply(req);
  return out instanceof Error ? Promise.reject(out) : Promise.resolve(out);
};
const regression = () =>
  new Response(JSON.stringify({ ok: false, error: 'regression', current: { sessions: 121, weights: 40 }, incoming: { sessions: 3, weights: 10 } }));

async function restoreText(text: string) {
  const preview = previewRestore(text);
  if (!preview.ok) throw new Error(preview.error.message);
  await restoreBackup(preview.value.data);
}

async function enableDrive() {
  await saveDriveConfig(URL_, SECRET);
  await markDriveTested('2026-10-04T10:00:00+02:00', { url: URL_, secret: SECRET });
  await setDriveEnabled(true);
  await setLastWeeklyBackupAt(new Date().toISOString());
}

/** Met la sauvegarde en pause par un refus de régression. */
async function pauseByRegression() {
  reply = regression;
  await enqueueDriveTask('backup_latest', 'latest');
  await processDriveOutbox('all');
}

function renderAt(hash: string) {
  window.location.hash = hash;
  const user = userEvent.setup();
  render(<App />);
  return user;
}

beforeEach(async () => {
  await resetDatabase();
  sent = [];
  reply = () => new Response('{"ok":true,"version":"sync-2","rootReady":true}');
  setDriveClient(createDriveClient({ fetch }));
  await restoreText(example('history-weights-example.json'));
});
afterEach(async () => {
  cleanup();
  await processDriveOutbox();
});

describe('Activation : texte complet du §8.3', () => {
  it('la confirmation mentionne le remplacement de Sauvegardes/sauvegarde-derniere.json', async () => {
    await saveDriveConfig(URL_, SECRET);
    await markDriveTested('2026-10-04T10:00:00+02:00', { url: URL_, secret: SECRET });
    const user = renderAt('#/settings/drive');
    await user.click(await screen.findByRole('switch', { name: /Envoi automatique/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Activer l’envoi automatique ?' });
    expect(
      within(sheet).getByText(
        'L’envoi automatique va créer et mettre à jour des fichiers dans ton Drive, dossier Muscu, et remplacer Sauvegardes/sauvegarde-derniere.json par une sauvegarde de CETTE app. Si tu viens de réinstaller l’app, restaure d’abord ta sauvegarde.',
      ),
    ).toBeInTheDocument();
  });
});

describe('Refus de régression : écran de choix (Paramètres ET accueil)', () => {
  beforeEach(enableDrive);

  it('message exact dans Paramètres et sur l’accueil ; rien n’a été écrasé', async () => {
    await pauseByRegression();
    const user = renderAt('#/settings/drive');
    const text = 'Ton Drive contient une sauvegarde plus complète (121 séances, 40 pesées) que cette app (3, 10). Rien n’a été écrasé.';
    expect(await screen.findByText(text)).toBeInTheDocument();
    expect(screen.getByText('En pause')).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Paramètres' }));
    await user.click(await screen.findByRole('link', { name: 'Retour' }));
    expect(await screen.findByText(text)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Restaurer depuis mon Drive' })).toBeInTheDocument();
  });

  it('« Restaurer depuis mon Drive » : explication pas à pas, la pause reste', async () => {
    await pauseByRegression();
    const user = renderAt('#/');
    await user.click(await screen.findByRole('button', { name: 'Restaurer depuis mon Drive' }));
    const sheet = await screen.findByRole('dialog', { name: 'Restaurer depuis ton Drive' });
    const steps = within(sheet).getAllByRole('listitem').map((li) => li.textContent);
    expect(steps).toHaveLength(4);
    expect(steps[1]).toContain('sauvegarde-derniere.json');
    expect(steps[2]).toContain('Restaurer une sauvegarde');
    await user.click(within(sheet).getByRole('button', { name: 'Compris' }));
    expect((await getOutbox()).regression).not.toBeNull();
  });

  it('« Remplacer quand même » : confirmation explicite, puis renvoi avec force:true', async () => {
    await pauseByRegression();
    reply = (req) => (req.force === true ? new Response('{"ok":true}') : regression());
    const user = renderAt('#/settings/drive');
    await user.click(await screen.findByRole('button', { name: 'Remplacer quand même' }));
    const sheet = await screen.findByRole('dialog', { name: 'Remplacer la sauvegarde du Drive ?' });
    await user.click(within(sheet).getByRole('button', { name: 'Remplacer' }));
    await waitFor(async () => {
      expect(await getLastAutoBackupAt()).not.toBeNull();
    });
    expect(sent.filter((r) => r.name === 'sauvegarde-derniere.json').map((r) => r.force ?? false)).toEqual([false, true]);
    expect(screen.queryByText(/Ton Drive contient une sauvegarde plus complète/)).not.toBeInTheDocument();
  });

  it('« Ignorer » : la sauvegarde en attente est abandonnée, l’écran disparaît', async () => {
    await pauseByRegression();
    const user = renderAt('#/');
    await user.click(await screen.findByRole('button', { name: 'Ignorer' }));
    await waitFor(async () => {
      expect((await getOutbox()).tasks).toEqual([]);
    });
    expect(screen.queryByText(/Ton Drive contient une sauvegarde plus complète/)).not.toBeInTheDocument();
  });
});

describe('Statuts des sauvegardes', () => {
  it('base vide : « Base vide : aucune sauvegarde envoyée (pour protéger ton archive). »', async () => {
    await resetDatabase();
    await enableDrive();
    await enqueueDriveTask('backup_latest', 'latest');
    await processDriveOutbox('all');
    renderAt('#/settings/drive');
    expect(await screen.findByText('Base vide : aucune sauvegarde envoyée (pour protéger ton archive).')).toBeInTheDocument();
    expect(sent).toEqual([]);
  });

  it('sauvegarde confirmée : date affichée ; le rappel d’export de l’accueil disparaît', async () => {
    await enableDrive();
    await setLastExportAt('2026-01-01T10:00:00+01:00');
    renderAt('#/');
    expect(await screen.findByText(/Pense à exporter/)).toBeInTheDocument();
    cleanup();
    await enqueueDriveTask('backup_latest', 'latest');
    await processDriveOutbox('all');
    const user = renderAt('#/');
    await screen.findAllByRole('heading', { name: 'Séance A' });
    expect(screen.queryByText(/Pense à exporter/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Paramètres' }));
    await user.click(await screen.findByRole('link', { name: 'Archive Drive' }));
    expect(await screen.findByText(/^Dernière sauvegarde envoyée :/)).toBeInTheDocument();
  });

  it('sauvegarde NON confirmée : le rappel d’export reste affiché', async () => {
    await enableDrive();
    await setLastExportAt('2026-01-01T10:00:00+01:00');
    reply = () => new TypeError('Failed to fetch');
    await enqueueDriveTask('backup_latest', 'latest');
    await processDriveOutbox('all');
    renderAt('#/');
    expect(await screen.findByText(/Pense à exporter/)).toBeInTheDocument();
  });
});

describe('« Renvoyer toute l’archive »', () => {
  beforeEach(enableDrive);

  it('progression « n/15 », annulation, relance sans doublon ; noms accessibles', async () => {
    reply = () => new TypeError('Failed to fetch');
    const user = renderAt('#/settings/drive');
    await user.click(await screen.findByRole('button', { name: 'Renvoyer toute l’archive' }));
    expect(await screen.findByText('0/15')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Renvoi de l’archive : 0 fichier sur 15' })).toBeInTheDocument();
    const unnamed = [...document.querySelectorAll<HTMLElement>('button, a[href], input')].filter((el) => computeAccessibleName(el).trim() === '');
    expect(unnamed).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Annuler le renvoi' }));
    expect(await screen.findByText('Renvoi annulé. Tu peux le relancer : rien ne sera envoyé en double.')).toBeInTheDocument();
    await waitFor(async () => {
      expect((await getOutbox()).tasks).toEqual([]);
    });

    reply = () => new Response('{"ok":true}');
    await user.click(screen.getByRole('button', { name: 'Renvoyer toute l’archive' }));
    expect(await screen.findByText('Archive renvoyée : 15 fichiers.', {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByText('15/15')).toBeInTheDocument();
  });
});
