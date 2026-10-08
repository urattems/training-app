// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../app/App';
import { db } from '../../db/database';
import { parseCoachExportJson } from '../../schemas/parse';
import { previewRestore, restoreBackup } from '../../services/importService';
import { resetDatabase } from '../../test/fixtures';

const example = (name: string) => readFileSync(resolve(process.cwd(), 'examples', name), 'utf8');

function setClipboard(value: Partial<Clipboard> | undefined) {
  Object.defineProperty(window.navigator, 'clipboard', { value, configurable: true, writable: true });
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

const measurementsSwitch = () => screen.getByRole('switch', { name: 'Joindre mes mensurations' });
const measurementsSection = () => screen.getByRole('region', { name: 'Mensurations' });
const waitReady = () =>
  waitFor(() => {
    expect(screen.getByRole('button', { name: 'Envoyer le fichier' })).toBeEnabled();
  });

beforeEach(async () => {
  // « Aujourd'hui » = 1er octobre 2026 : la fenêtre par défaut couvre les prises de septembre.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 1, 18, 50, 0));
  await resetDatabase();
  await restoreText(example('history-measurements-example.json'));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Exporter pour le coach : « Joindre mes mensurations »', () => {
  it('décochée par défaut ; sous-texte neutre ; aucun nombre de prises tant que non cochée', async () => {
    renderAt('#/settings/coach');
    await waitReady();
    expect(measurementsSwitch()).not.toBeChecked();
    expect(within(measurementsSection()).getByText('Les prises de la même période que les pesées.')).toBeInTheDocument();
    expect(within(measurementsSection()).queryByText(/prise(s)? *$|Aucune prise/)).not.toBeInTheDocument();
    // Le résumé ne mentionne pas les mensurations.
    expect(screen.queryByText(/de mensurations/)).not.toBeInTheDocument();
  });

  it('cochée : nombre de prises jointes, mention dans le résumé, et copie compacte en 1.2', async () => {
    const user = renderAt('#/settings/coach');
    // Après le rendu : `userEvent.setup()` installe son propre presse-papiers simulé.
    const writeText = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve());
    setClipboard({ writeText });
    await waitReady();
    await user.click(measurementsSwitch());
    expect(within(measurementsSection()).getByText(/^\d+ prises?$/)).toBeInTheDocument();
    await waitReady();
    expect(await screen.findByText(/ · \d+ prises? de mensurations/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Copier pour ChatGPT' }));
    expect(await screen.findByText('Copié')).toBeInTheDocument();
    const copied = writeText.mock.calls[0]?.[0] ?? '';
    expect(copied.startsWith('{"schemaVersion":"1.2","type":"training_coach_export"')).toBe(true);
    const parsed = parseCoachExportJson(copied);
    expect(parsed.ok && parsed.value.schemaVersion === '1.2' && parsed.value.measurementEntries.length).toBeGreaterThan(0);
  });

  it('non cochée : la copie reste le format 1.1, sans aucune clé de mensurations', async () => {
    const user = renderAt('#/settings/coach');
    // Après le rendu : `userEvent.setup()` installe son propre presse-papiers simulé.
    const writeText = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve());
    setClipboard({ writeText });
    await waitReady();
    await user.click(screen.getByRole('button', { name: 'Copier pour ChatGPT' }));
    expect(await screen.findByText('Copié')).toBeInTheDocument();
    const copied = writeText.mock.calls[0]?.[0] ?? '';
    expect(copied.startsWith('{"schemaVersion":"1.1","type":"training_coach_export"')).toBe(true);
    expect(copied).not.toContain('measurement');
  });

  it('aucune prise sur la période : « Aucune prise sur cette période », l’export reste possible', async () => {
    // Une seule prise, de novembre 2025 : hors de la fenêtre des 30 derniers jours.
    await db.measurements.bulkDelete(['2026-03-30', '2026-07-01', '2026-09-01', '2026-09-29']);
    const user = renderAt('#/settings/coach');
    await waitReady();
    await user.click(measurementsSwitch());
    expect(within(measurementsSection()).getByText('Aucune prise sur cette période')).toBeInTheDocument();
    await waitReady();
    expect(screen.getByRole('button', { name: 'Copier pour ChatGPT' })).toBeEnabled();
  });

  it('aucune mensuration en base : une phrase, pas d’interrupteur ; l’export reste en 1.1', async () => {
    await db.measurements.clear();
    renderAt('#/settings/coach');
    await waitReady();
    expect(within(measurementsSection()).getByText('Aucune mensuration enregistrée : rien ne sera ajouté.')).toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'Joindre mes mensurations' })).not.toBeInTheDocument();
  });

  it('le choix n’est pas mémorisé : rouvrir l’écran = décochée', async () => {
    const user = renderAt('#/settings/coach');
    await waitReady();
    await user.click(measurementsSwitch());
    expect(measurementsSwitch()).toBeChecked();
    cleanup();
    renderAt('#/settings/coach');
    await waitReady();
    expect(measurementsSwitch()).not.toBeChecked();
  });
});
