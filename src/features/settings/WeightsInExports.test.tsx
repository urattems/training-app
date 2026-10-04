// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../app/App';
import { parseCoachExportJson } from '../../schemas/parse';
import { previewRestore, restoreBackup } from '../../services/importService';
import { getLastExportAt } from '../../services/settingsService';
import { addWeight, listWeights } from '../../services/weightService';
import { readFixture, resetDatabase } from '../../test/fixtures';

const example = (name: string) => readFileSync(resolve(process.cwd(), 'examples', name), 'utf8');

let downloaded: Blob[] = [];
function stubDownload() {
  downloaded = [];
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: (blob: Blob) => {
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

const weightsSection = () => screen.getByRole('region', { name: 'Pesées' });
const preview = () => within(weightsSection()).getByText(/pesée|Pesées non jointes|Aucune pesée/, { selector: 'p' });
const waitReady = () =>
  waitFor(() => {
    expect(screen.getByRole('button', { name: 'Envoyer le fichier' })).toBeEnabled();
  });

/** Envoie le fichier (repli téléchargement) et le relit. */
async function sendAndRead(user: ReturnType<typeof userEvent.setup>) {
  await waitReady();
  await user.click(screen.getByRole('button', { name: 'Envoyer le fichier' }));
  await screen.findByText(/^Fichier téléchargé/);
  const parsed = parseCoachExportJson(await (downloaded.at(-1) as Blob).text());
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed.value;
}

beforeEach(async () => {
  // « Aujourd'hui » = mardi 20 octobre 2026.
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

describe('Export pour le coach : section « Pesées »', () => {
  beforeEach(async () => {
    await restoreText(example('history-weights-example.json'));
  });

  it('activée par défaut, fenêtre « 30 derniers jours (ou plus…) », aperçu exact', async () => {
    const user = renderAt('#/settings/coach');
    const toggle = await screen.findByRole('switch', { name: 'Joindre mes pesées' });
    expect(toggle).toBeChecked();
    expect(screen.getByRole('radio', { name: '30 derniers jours (ou plus si tes séances sont plus anciennes)' })).toBeChecked();
    // Par défaut toutes les séances (8 sept. → 22 sept.) : la fenêtre remonte au 8 sept.
    expect(preview()).toHaveTextContent('8 pesées · 8 sept. au 20 oct.');

    await user.click(screen.getByRole('button', { name: 'Dernière séance' }));
    // Séance du 22 sept. : 30 jours avant le 20 oct. = 20 sept. (plus ancien).
    expect(preview()).toHaveTextContent('4 pesées · 20 sept. au 20 oct.');
    const file = await sendAndRead(user);
    expect(file.weightWindow).toEqual({ mode: 'auto_30d', from: '2026-09-20', to: '2026-10-20', count: 4 });
    expect(file.weightEntries).toHaveLength(4);
  });

  it('chaque fenêtre : 90 jours, tout l’historique', async () => {
    await addWeight({ date: '2026-03-15', weightKg: 85.2 });
    const user = renderAt('#/settings/coach');
    await user.click(await screen.findByRole('radio', { name: '90 jours' }));
    expect(preview()).toHaveTextContent('10 pesées · 22 juil. au 20 oct.');
    let file = await sendAndRead(user);
    expect(file.weightWindow).toMatchObject({ mode: 'days_90', from: '2026-07-22', count: 10 });

    await user.click(screen.getByRole('radio', { name: 'Tout l’historique' }));
    expect(preview()).toHaveTextContent('11 pesées · 15 mars au 20 oct.');
    file = await sendAndRead(user);
    expect(file.weightWindow).toMatchObject({ mode: 'all', from: '2026-03-15', count: 11 });
    expect(file.weightEntries[0]).toEqual({ date: '2026-03-15', weightKg: 85.2 });
  });

  it('désactivée : weightWindow null, aucune pesée dans le fichier ; l’envoi ne touche pas lastExportAt', async () => {
    const user = renderAt('#/settings/coach');
    await user.click(await screen.findByRole('switch', { name: 'Joindre mes pesées' }));
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(preview()).toHaveTextContent('Pesées non jointes.');
    const file = await sendAndRead(user);
    expect(file.weightWindow).toBeNull();
    expect(file.weightEntries).toEqual([]);
    expect(await getLastExportAt()).toBeNull();
  });
});

describe('Export pour le coach : aucune pesée en base', () => {
  it('la section l’indique ; fichier : fenêtre renseignée avec count 0 (décision V1.2b)', async () => {
    await restoreText(readFixture('history-example.json'));
    const user = renderAt('#/settings/coach');
    expect(await within(await screen.findByRole('region', { name: 'Pesées' })).findByText('Aucune pesée enregistrée : rien ne sera ajouté.')).toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    const file = await sendAndRead(user);
    expect(file.weightEntries).toEqual([]);
    expect(file.weightWindow).toMatchObject({ mode: 'auto_30d', count: 0 });
  });
});

describe('Restauration : pesées dans le résumé', () => {
  it('nombre de pesées du fichier affiché', async () => {
    await restoreText(readFixture('history-example.json'));
    const user = renderAt('#/settings');
    await screen.findByText(/1 programme et 3 séances/);
    await user.upload(screen.getByLabelText('Choisir un fichier de sauvegarde (.json)'), new File([example('history-weights-example.json')], 'b.json'));
    const dialog = await screen.findByRole('dialog', { name: 'Restaurer cette sauvegarde ?' });
    expect(within(dialog).getByText('Pesées').nextElementSibling).toHaveTextContent('10');
    expect(within(dialog).getByText('Version du schéma').nextElementSibling).toHaveTextContent('1.1');
    expect(within(dialog).queryByText(/ne contient aucune pesée/)).not.toBeInTheDocument();
  });

  it('fichier SANS pesée alors que l’app en contient : avertissement visible ; la restauration les remplace', async () => {
    await restoreText(example('history-weights-example.json'));
    const user = renderAt('#/settings');
    await screen.findByText(/1 programme, 3 séances et 10 pesées : sauvegarde complète/);
    await user.upload(screen.getByLabelText('Choisir un fichier de sauvegarde (.json)'), new File([readFixture('history-example.json')], 'b.json'));
    const dialog = await screen.findByRole('dialog', { name: 'Restaurer cette sauvegarde ?' });
    expect(within(dialog).getByText('Pesées').nextElementSibling).toHaveTextContent('0');
    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      'Cette sauvegarde ne contient aucune pesée : tes 10 pesées actuelles seront remplacées (une copie de sécurité est conservée).',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Exporter mes données actuelles' }));
    const restore = within(dialog).getByRole('button', { name: 'Restaurer' });
    await waitFor(() => {
      expect(restore).toBeEnabled();
    });
    // L'export de sécurité contient bien les 10 pesées.
    const safety = JSON.parse(await (downloaded.at(-1) as Blob).text()) as { weightEntries: unknown[] };
    expect(safety.weightEntries).toHaveLength(10);
    await user.click(restore);
    await screen.findByRole('dialog', { name: 'Sauvegarde restaurée' });
    expect(await listWeights()).toEqual([]);
  });

  it('des pesées seules suffisent à exiger l’export de sécurité avant de restaurer', async () => {
    await addWeight({ date: '2026-10-19', weightKg: 80 });
    const user = renderAt('#/settings');
    await screen.findByText(/0 programme, 0 séance et 1 pesée/);
    await user.upload(screen.getByLabelText('Choisir un fichier de sauvegarde (.json)'), new File([readFixture('history-example.json')], 'b.json'));
    const dialog = await screen.findByRole('dialog', { name: 'Restaurer cette sauvegarde ?' });
    expect(within(dialog).getByRole('button', { name: 'Restaurer' })).toBeDisabled();
    expect(within(dialog).getByRole('alert')).toHaveTextContent('ta pesée actuelle sera remplacée');
  });
});
