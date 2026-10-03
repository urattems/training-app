// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { computeAccessibleName } from 'dom-accessibility-api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../app/App';
import { parseCoachExportJson } from '../../schemas/parse';
import { previewRestore, restoreBackup } from '../../services/importService';
import { importProgram, previewProgram } from '../../services/programService';
import { getLastCoachExportAt, getLastExportAt, setLastCoachExportAt } from '../../services/settingsService';
import { readFixture, resetDatabase } from '../../test/fixtures';

/** Blobs remis au téléchargement (jsdom n'a pas URL.createObjectURL). */
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

/** Cases cochées, dans l'ordre affiché (récent → ancien). */
const checkedLabels = () =>
  screen
    .getAllByRole('checkbox')
    .filter((c) => (c as HTMLInputElement).checked)
    .map((c) => c.getAttribute('aria-label'));

const S1 = 'Séance A, mardi 8 septembre';
const S2 = 'Séance A, mardi 15 septembre';
const S3 = 'Séance A, mardi 22 septembre';

const sendButton = () => screen.getByRole('button', { name: /Envoyer le fichier|Préparation/ });
const waitReady = () => waitFor(() => {
  expect(screen.getByRole('button', { name: 'Envoyer le fichier' })).toBeEnabled();
});

beforeEach(async () => {
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

describe('Paramètres → Données : deux exports distincts', () => {
  it('une ligne d’aide sous chacun ; l’entrée mène à l’écran de sélection', async () => {
    await restoreText(readFixture('history-example.json'));
    const user = renderAt('#/settings');
    expect(await screen.findByText(/1 programme et 3 séances : sauvegarde complète/)).toBeInTheDocument();
    expect(screen.getByText(/Une sélection de séances à envoyer au coach/)).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Exporter pour le coach' }));
    expect(await screen.findByRole('heading', { name: 'Export pour le coach' })).toBeInTheDocument();
    expect(window.location.hash).toBe('#/settings/coach');
  });
});

describe('Écran « Export pour le coach »', () => {
  beforeEach(async () => {
    await restoreText(readFixture('history-example.json'));
  });

  it('sans envoi précédent : toutes cochées, et le décompte le dit clairement', async () => {
    renderAt('#/settings/coach');
    expect(await screen.findByText('Aucun envoi précédent : toutes les séances sont cochées.')).toBeInTheDocument();
    expect(checkedLabels()).toEqual([S3, S2, S1]);
    expect(screen.getByText('3 séances · 8 sept. au 22 sept.')).toBeInTheDocument();
    expect(screen.getByText('sur 3 exportables')).toBeInTheDocument();
    expect(screen.getByText('Aucun envoi au coach pour l’instant.')).toBeInTheDocument();
  });

  it('raccourcis : Dernière séance, 3 dernières, 6 dernières, N dernières (clavier numérique)', async () => {
    const user = renderAt('#/settings/coach');
    await user.click(await screen.findByRole('button', { name: 'Dernière séance' }));
    expect(checkedLabels()).toEqual([S3]);
    expect(screen.getByText('1 séance · 22 sept.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dernière séance' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', { name: '3 dernières' }));
    expect(checkedLabels()).toEqual([S3, S2, S1]);
    await user.click(screen.getByRole('button', { name: 'Dernière séance' }));
    await user.click(screen.getByRole('button', { name: '6 dernières' }));
    expect(checkedLabels()).toEqual([S3, S2, S1]);

    const n = screen.getByLabelText('Nombre de dernières séances à cocher');
    expect(n).toHaveAttribute('inputmode', 'numeric');
    await user.type(n, '2');
    expect(checkedLabels()).toEqual([S3, S2]);
    expect(screen.getByText('2 séances · 15 sept. au 22 sept.')).toBeInTheDocument();
  });

  it('sélection manuelle, ajustable après un raccourci ; aucune case → boutons désactivés', async () => {
    const user = renderAt('#/settings/coach');
    await user.click(await screen.findByRole('button', { name: 'Dernière séance' }));
    await user.click(screen.getByRole('checkbox', { name: S1 }));
    expect(checkedLabels()).toEqual([S3, S1]);
    expect(screen.getByRole('button', { name: 'Dernière séance' })).toHaveAttribute('aria-pressed', 'false');

    await user.click(screen.getByRole('checkbox', { name: S3 }));
    await user.click(screen.getByRole('checkbox', { name: S1 }));
    expect(checkedLabels()).toEqual([]);
    expect(screen.getByText('Aucune séance sélectionnée')).toBeInTheDocument();
    expect(sendButton()).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Copier pour ChatGPT' })).toBeDisabled();
  });

  it('« Depuis mon dernier envoi » avec une date figée : seules les séances suivantes', async () => {
    await setLastCoachExportAt('2026-09-16T12:00:00+02:00');
    const user = renderAt('#/settings/coach');
    expect(await screen.findByText(/^Séances depuis ton dernier envoi \(mercredi 16 septembre à 12:00\)/)).toBeInTheDocument();
    expect(checkedLabels()).toEqual([S3]);
    await user.click(screen.getByRole('button', { name: '3 dernières' }));
    await user.click(screen.getByRole('button', { name: 'Depuis mon dernier envoi au coach' }));
    expect(checkedLabels()).toEqual([S3]);
  });

  it('envoi du fichier (repli téléchargement) : contenu exact, lastCoachExportAt écrit, lastExportAt intact', async () => {
    const user = renderAt('#/settings/coach');
    await user.click(await screen.findByRole('button', { name: '3 dernières' }));
    await user.click(screen.getByRole('checkbox', { name: S2 }));
    await waitReady();
    await user.click(sendButton());

    expect(await screen.findByText('Fichier téléchargé : training-coach-2026-10-20.json')).toBeInTheDocument();
    expect(downloaded).toHaveLength(1);
    const parsed = parseCoachExportJson(await (downloaded[0] as Blob).text());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.sessions.map((s) => s.id)).toEqual(['w-0001', 'w-0003']);
    expect(parsed.value.selection).toMatchObject({ mode: 'manual', sessionCount: 2, totalExportableSessions: 3 });
    expect(await getLastCoachExportAt()).toBe(parsed.value.exportedAt);
    expect(await getLastExportAt()).toBeNull();
    expect(await screen.findByText(/^Dernier envoi au coach : mardi 20 octobre à 12:00/)).toBeInTheDocument();
  });

  it('« Copier pour ChatGPT » : JSON compact seul, confirmation discrète « Copié »', async () => {
    const user = renderAt('#/settings/coach');
    const writeText = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve());
    setClipboard({ writeText });
    await user.click(await screen.findByRole('button', { name: 'Dernière séance' }));
    await waitReady();
    await user.click(screen.getByRole('button', { name: 'Copier pour ChatGPT' }));

    expect(await screen.findByText('Copié')).toBeInTheDocument();
    const copied = writeText.mock.calls[0]?.[0] ?? '';
    expect(copied.startsWith('{"schemaVersion":"1.1","type":"training_coach_export"')).toBe(true);
    expect(copied).not.toContain('\n');
    expect(parseCoachExportJson(copied).ok).toBe(true);
    expect(await getLastCoachExportAt()).not.toBeNull();
    expect(await getLastExportAt()).toBeNull();
  });

  it('copie refusée : repli clair vers le téléchargement, rien d’écrit avant', async () => {
    const user = renderAt('#/settings/coach');
    setClipboard({ writeText: () => Promise.reject(new DOMException('Refusé', 'NotAllowedError')) });
    await user.click(await screen.findByRole('button', { name: 'Dernière séance' }));
    await waitReady();
    await user.click(screen.getByRole('button', { name: 'Copier pour ChatGPT' }));

    expect(await screen.findByText(/Copie impossible sur cet appareil/)).toBeInTheDocument();
    expect(screen.queryByText('Copié')).not.toBeInTheDocument();
    expect(await getLastCoachExportAt()).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Télécharger le fichier' }));
    expect(await screen.findByText('Fichier téléchargé : training-coach-2026-10-20.json')).toBeInTheDocument();
    expect(downloaded).toHaveLength(1);
    expect(await getLastCoachExportAt()).not.toBeNull();
  });

  it('presse-papiers absent (HTTP local) : même repli', async () => {
    const user = renderAt('#/settings/coach');
    setClipboard(undefined);
    await user.click(await screen.findByRole('button', { name: 'Dernière séance' }));
    await waitReady();
    await user.click(screen.getByRole('button', { name: 'Copier pour ChatGPT' }));
    expect(await screen.findByRole('button', { name: 'Télécharger le fichier' })).toBeInTheDocument();
  });

  it('cases à cocher : lignes entières cliquables, avec statut et durée', async () => {
    renderAt('#/settings/coach');
    const box = await screen.findByRole('checkbox', { name: S3 });
    const row = box.closest('label');
    expect(row).not.toBeNull();
    if (!row) return;
    expect(within(row).getByText('Abandonnée')).toBeInTheDocument();
    const first = screen.getByRole('checkbox', { name: S1 }).closest('label');
    expect(first && within(first).getByText('mardi 8 septembre · 1 h 08')).toBeInTheDocument();
  });
});

describe('Accessibilité de l’écran', () => {
  it('chaque bouton, lien, case et champ a un nom accessible', async () => {
    await restoreText(readFixture('history-example.json'));
    renderAt('#/settings/coach');
    await screen.findByRole('checkbox', { name: S3 });
    const elements = [...document.querySelectorAll<HTMLElement>('button, a[href], input, textarea, select')];
    expect(elements.length).toBeGreaterThan(10);
    expect(elements.filter((el) => computeAccessibleName(el).trim() === '').map((el) => el.outerHTML.slice(0, 120))).toEqual([]);
  });
});

describe('Aucune séance exportable', () => {
  it('état vide clair, raccourcis et boutons désactivés', async () => {
    const program = previewProgram(readFixture('program-example.json'));
    if (!program.ok) throw new Error();
    await importProgram(program.value.program);
    renderAt('#/settings/coach');
    expect(await screen.findByRole('heading', { name: 'Aucune séance à envoyer' })).toBeInTheDocument();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    for (const name of ['Dernière séance', '3 dernières', '6 dernières', 'Depuis mon dernier envoi au coach', 'Envoyer le fichier', 'Copier pour ChatGPT']) {
      expect(screen.getByRole('button', { name })).toBeDisabled();
    }
    expect(screen.getByLabelText('Nombre de dernières séances à cocher')).toBeDisabled();
    expect(screen.getByText('sur 0 exportable')).toBeInTheDocument();
  });
});
