// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { computeAccessibleName } from 'dom-accessibility-api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../app/App';
import { createDriveClient, type FetchLike } from '../../services/driveClient';
import { enqueueDriveTask, getOutbox, processDriveOutbox, setDriveClient } from '../../services/driveOutbox';
import { getDriveSync, markDriveTested, saveDriveConfig, setDriveEnabled } from '../../services/driveSettings';
import { previewRestore, restoreBackup } from '../../services/importService';
import { setLastWeeklyBackupAt } from '../../services/settingsService';
import { readFixture, resetDatabase } from '../../test/fixtures';
import { loadDemoData } from './DevTools';

const URL_ = 'https://script.google.com/macros/s/AKfycbUITESTSCRIPTID/exec';
const SECRET = 'secret-interface-9876';

let reply: (body: { action: string }) => Response | Error = () => new Response('{"ok":true,"version":"sync-2","rootReady":true}');
let requests: { action: string }[] = [];
const fetch: FetchLike = (_url, init) => {
  const body = JSON.parse(init.body as string) as { action: string };
  requests.push(body);
  const out = reply(body);
  return out instanceof Error ? Promise.reject(out) : Promise.resolve(out);
};

async function restoreText(text: string) {
  const preview = previewRestore(text);
  if (!preview.ok) throw new Error(preview.error.message);
  await restoreBackup(preview.value.data);
}

async function configure(enabled: boolean) {
  await saveDriveConfig(URL_, SECRET);
  await markDriveTested('2026-10-04T10:00:00+02:00', { url: URL_, secret: SECRET });
  if (enabled) await setDriveEnabled(true);
  // V1.3b : copie hebdomadaire récente, donc pas due à l'ouverture (scénarios centrés sur les séances).
  await setLastWeeklyBackupAt(new Date().toISOString());
}

function renderAt(hash: string) {
  window.location.hash = hash;
  const user = userEvent.setup();
  render(<App />);
  return user;
}

const bodyText = () => document.body.textContent;

beforeEach(async () => {
  await resetDatabase();
  requests = [];
  reply = () => new Response('{"ok":true,"version":"sync-2","rootReady":true}');
  setDriveClient(createDriveClient({ fetch }));
  await restoreText(readFixture('history-example.json'));
});
afterEach(async () => {
  cleanup();
  vi.useRealTimers();
  await processDriveOutbox();
});

describe('Paramètres → Données → Archive Drive', () => {
  it('entrée avec aide ; page : champs sans correction, secret masqué, désactivé par défaut', async () => {
    const user = renderAt('#/settings');
    expect(await screen.findByText(/Copie automatique de tes séances dans ton Google Drive/)).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Archive Drive' }));
    expect(window.location.hash).toBe('#/settings/drive');
    const url = await screen.findByLabelText('Adresse du script (URL)');
    for (const attr of ['autocapitalize', 'autocorrect']) expect(url).toHaveAttribute(attr, 'off');
    expect(url).toHaveAttribute('spellcheck', 'false');
    expect(screen.getByLabelText('Secret')).toHaveAttribute('type', 'password');
    expect(screen.getByRole('switch', { name: /Envoi automatique/ })).toBeDisabled();
    expect(screen.getByText('Envoi automatique désactivé.')).toBeInTheDocument();
  });

  it('enregistrer : erreurs claires, puis secret masqué (4 derniers caractères), jamais affiché en clair', async () => {
    const user = renderAt('#/settings/drive');
    const url = await screen.findByLabelText('Adresse du script (URL)');
    await user.type(url, 'pas une url');
    await user.type(screen.getByLabelText('Secret'), SECRET);
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Adresse invalide');
    await user.clear(url);
    await user.type(url, URL_);
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(await screen.findByText('Configuration enregistrée. Fais un test avant d’activer l’envoi.')).toBeInTheDocument();
    expect(screen.getByLabelText('Secret')).toHaveValue('');
    expect(screen.getByText(/Secret enregistré : ••••9876/)).toBeInTheDocument();
    expect(bodyText()).not.toContain(SECRET);
    expect(await getDriveSync()).toMatchObject({ url: URL_, secret: SECRET, enabled: false });
  });

  it('test réussi : version, latence, dossier prêt ; puis activation avec confirmation explicite', async () => {
    await saveDriveConfig(URL_, SECRET);
    const user = renderAt('#/settings/drive');
    await user.click(await screen.findByRole('button', { name: 'Envoyer un test' }));
    expect(await screen.findByText(/^Script joint : version sync-2, réponse en [\d,]+ s\.$/)).toBeInTheDocument();
    expect(screen.getByText('Dossier Muscu prêt.')).toBeInTheDocument();
    const toggle = await screen.findByRole('switch', { name: /Envoi automatique/ });
    await waitFor(() => {
      expect(toggle).toBeEnabled();
    });
    await user.click(toggle);
    const sheet = await screen.findByRole('dialog', { name: 'Activer l’envoi automatique ?' });
    expect(within(sheet).getByText(/créer et mettre à jour des fichiers dans ton Drive, dossier Muscu/)).toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: 'Activer' }));
    await waitFor(async () => {
      expect((await getDriveSync()).enabled).toBe(true);
    });
    expect(requests.map((r) => r.action)).toEqual(['ping']);
  });

  it('test en échec : message français clair, détails sans le secret', async () => {
    await saveDriveConfig(URL_, SECRET);
    reply = () => new Response(`<html>Erreur ${SECRET} ${URL_}</html>`, { status: 404, headers: { 'content-type': 'text/html' } });
    const user = renderAt('#/settings/drive');
    await user.click(await screen.findByRole('button', { name: 'Envoyer un test' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Le test a échoué. Le script a répondu par une page d’erreur (cas fréquent chez Google).');
    await user.click(within(alert).getByRole('button', { name: 'Détails techniques' }));
    expect(alert).toHaveTextContent(/html · HTTP 404/);
    expect(bodyText()).not.toContain(SECRET);
    expect(bodyText()).not.toContain('AKfycbUITESTSCRIPTID');

    reply = () => new Response('{"ok":false,"error":"unauthorized"}');
    await user.click(screen.getByRole('button', { name: 'Envoyer un test' }));
    expect(await screen.findByText('Le test a échoué. Secret refusé par le script : vérifie le secret.')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /Envoi automatique/ })).toBeDisabled();
  });

  it('état et file : en attente / en erreur, Réessayer, Ignorer, Envoyer maintenant', async () => {
    await configure(true);
    reply = () => new Response('{"ok":false,"error":"forbidden_name"}');
    await enqueueDriveTask('session', 'w-0001');
    await processDriveOutbox('all');
    const user = renderAt('#/settings/drive');
    expect(await screen.findByText('1 en erreur')).toBeInTheDocument();
    expect(screen.getByText('Séance Séance A · 8 sept.')).toBeInTheDocument();
    expect(screen.getByText('Nom de fichier refusé par le script.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Détails techniques' }));
    expect(screen.getByText(/forbidden_name · requestId/)).toBeInTheDocument();

    reply = () => new Response('{"ok":true}');
    await user.click(screen.getByRole('button', { name: 'Réessayer' }));
    await waitFor(async () => {
      expect((await getOutbox()).tasks).toEqual([]);
    });
    expect(await screen.findByText(/^Dernier envoi confirmé :/)).toBeInTheDocument();

    reply = () => new Response('{"ok":false,"error":"bad_request"}');
    await enqueueDriveTask('session', 'w-0002');
    await user.click(screen.getByRole('button', { name: 'Envoyer maintenant' }));
    await user.click(await screen.findByRole('button', { name: 'Ignorer' }));
    await waitFor(async () => {
      expect((await getOutbox()).tasks).toEqual([]);
    });
    expect(bodyText()).not.toContain(SECRET);
  });

  it('accessibilité : chaque contrôle a un nom ; le statut est annoncé', async () => {
    await configure(true);
    reply = () => new Response('{"ok":false,"error":"bad_request"}');
    await enqueueDriveTask('session', 'w-0001');
    await processDriveOutbox('all');
    renderAt('#/settings/drive');
    await screen.findByText('1 en erreur');
    const unnamed = [...document.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea')]
      .filter((el) => computeAccessibleName(el).trim() === '')
      .map((el) => el.outerHTML.slice(0, 100));
    expect(unnamed).toEqual([]);
    expect(document.querySelector('[aria-live="polite"]')).not.toBeNull();
  });
});

describe('Accueil : ligne d’état et puce', () => {
  it('séance terminée : « Archive Drive : ✓ envoyé » sous la dernière séance', async () => {
    await configure(true);
    await enqueueDriveTask('session', 'w-0003');
    await processDriveOutbox('all');
    renderAt('#/');
    expect(await screen.findByText('Archive Drive : ✓ envoyé')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Archive Drive : \d+ en attente/ })).not.toBeInTheDocument();
  });

  it('en attente depuis plus d’une heure : puce discrète vers les réglages ; ligne « en attente de réseau »', async () => {
    await configure(true);
    reply = () => new TypeError('Failed to fetch');
    await enqueueDriveTask('session', 'w-0003', new Date(Date.now() - 2 * 3_600_000));
    const user = renderAt('#/');
    const chip = await screen.findByRole('link', { name: 'Archive Drive : 1 en attente' });
    expect(await screen.findByText('Archive Drive : en attente de réseau')).toBeInTheDocument();
    await user.click(chip);
    expect(window.location.hash).toBe('#/settings/drive');
  });

  it('envoi désactivé : ni ligne ni puce, aucune requête', async () => {
    renderAt('#/');
    await screen.findAllByRole('heading', { name: 'Séance A' });
    expect(screen.queryByText(/Archive Drive/)).not.toBeInTheDocument();
    expect(requests).toEqual([]);
  });
});

describe('Import : libellé de semaine en double (alerte douce, non bloquante)', () => {
  it('« Une semaine … existe déjà. Le dossier Drive sera nommé … »', async () => {
    const program = JSON.parse(readFixture('program-example.json')) as { programId: string; week: { label: string }; createdAt: string };
    program.programId = 'b7c2-w40-bis';
    program.week.label = 'Semaine 37';
    program.createdAt = '2026-10-02T08:00:00+02:00';
    const user = renderAt('#/settings');
    await user.click(await screen.findByRole('button', { name: 'Coller le JSON' }));
    const dialog = await screen.findByRole('dialog', { name: 'Coller un programme' });
    await user.click(within(dialog).getByLabelText('JSON du programme'));
    await user.paste(JSON.stringify(program));
    await user.click(within(dialog).getByRole('button', { name: 'Vérifier' }));
    const preview = await screen.findByRole('dialog', { name: 'Importer ce programme ?' });
    expect(await within(preview).findByText('Une semaine « Semaine 37 » existe déjà. Le dossier Drive sera nommé « Semaine 37 (b7c2-w40-bis) ».')).toBeInTheDocument();
    expect(within(preview).getByRole('button', { name: 'Importer' })).toBeEnabled();
  });
});

describe('Chargeur de démo (mode développement)', () => {
  it('désactive l’envoi', async () => {
    await configure(true);
    await loadDemoData();
    expect((await getDriveSync()).enabled).toBe(false);
  });
});
