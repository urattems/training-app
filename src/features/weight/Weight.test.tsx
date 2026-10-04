// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { computeAccessibleName } from 'dom-accessibility-api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../app/App';
import { previewRestore, restoreBackup } from '../../services/importService';
import { addWeight, getWeight, listWeights } from '../../services/weightService';
import { TEST_TIME_ZONE } from '../../test/globalSetup';
import { resetDatabase } from '../../test/fixtures';

const WEIGHTS = readFileSync(resolve(process.cwd(), 'examples', 'history-weights-example.json'), 'utf8');

async function seedWeights() {
  const preview = previewRestore(WEIGHTS);
  if (!preview.ok) throw new Error(preview.error.message);
  await restoreBackup(preview.value.data);
}

function renderAt(hash: string) {
  window.location.hash = hash;
  const user = userEvent.setup();
  render(<App />);
  return user;
}

const todayInput = () => screen.getByLabelText('Poids du jour en kg');
const chartLabel = () => screen.getByRole('figure').getAttribute('aria-label');
const statValue = (label: string) => {
  const dt = screen.getAllByText(label, { selector: 'dt' })[0];
  return dt?.nextElementSibling?.textContent;
};
const listRows = () =>
  screen
    .getAllByRole('button', { name: /^Supprimer la pesée du / })
    .map((b) => b.closest('li')?.textContent ?? '');

beforeEach(async () => {
  // Seul Date est simulé : « aujourd'hui » = samedi 3 octobre 2026, midi.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 3, 12, 0, 0));
  await resetDatabase();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Onglet « Poids » : navigation et états vides', () => {
  it('4ᵉ onglet visible ; aucune pesée : message clair, saisie disponible', async () => {
    const user = renderAt('#/');
    const nav = await screen.findByRole('navigation', { name: 'Navigation principale' });
    await user.click(within(nav).getByRole('link', { name: 'Poids' }));
    expect(window.location.hash).toBe('#/weight');
    expect(await screen.findByRole('heading', { name: 'Poids', level: 1 })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Poids' })).toHaveAttribute('aria-current', 'page');
    expect(await screen.findByRole('heading', { name: 'Aucune pesée pour l’instant' })).toBeInTheDocument();
    const input = todayInput();
    expect(input).toHaveAttribute('inputmode', 'decimal');
    expect(input).toHaveAttribute('enterkeyhint', 'done');
    expect(input).toHaveAttribute('placeholder', '');
    expect(screen.queryByRole('figure')).not.toBeInTheDocument();
  });

  it('première pesée du jour : enregistrée à la date locale, un seul point affiché', async () => {
    const user = renderAt('#/weight');
    await user.type(await screen.findByLabelText('Poids du jour en kg'), '80,45');
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(await screen.findByText('Pesée enregistrée : 80,45 kg (samedi 3 octobre).')).toBeInTheDocument();
    expect(await getWeight('2026-10-03')).toMatchObject({ weightKg: 80.45, recordedAt: '2026-10-03T12:00:00+02:00' });
    expect(todayInput()).toHaveValue('');
    expect(await screen.findByRole('figure')).toHaveAttribute('aria-label', 'Courbe du poids — 1 pesée');
    expect(screen.getByText('Première pesée')).toBeInTheDocument();
  });

  it('saisie invalide : message clair, rien d’écrit (3 décimales, zéro, texte)', async () => {
    const user = renderAt('#/weight');
    const input = await screen.findByLabelText('Poids du jour en kg');
    for (const [text, message] of [
      ['80,456', 'Au plus 2 décimales (ex. 78,45).'],
      ['0', 'Le poids doit être supérieur à 0.'],
      ['abc', 'Valeur invalide : chiffres uniquement (ex. 78,4).'],
      ['', 'Indique un poids.'],
    ] as const) {
      await user.clear(input);
      if (text !== '') await user.type(input, text);
      await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
      expect(await screen.findByRole('alert')).toHaveTextContent(message);
      expect(input).toHaveAttribute('aria-invalid', 'true');
    }
    expect(await listWeights()).toEqual([]);
  });
});

describe('Saisie du jour : remplacement et avertissement doux', () => {
  beforeEach(seedWeights);

  it('dernier poids en PLACEHOLDER gris, jamais prérempli', async () => {
    renderAt('#/weight');
    const input = await screen.findByLabelText('Poids du jour en kg');
    expect(input).toHaveAttribute('placeholder', '80,6');
    expect(input).toHaveValue('');
  });

  it('une pesée existe déjà aujourd’hui : confirmation explicite, annuler ne change rien', async () => {
    await addWeight({ date: '2026-10-03', weightKg: 79.2 });
    const user = renderAt('#/weight');
    await user.type(await screen.findByLabelText('Poids du jour en kg'), '78,9');
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    const dialog = await screen.findByRole('dialog', { name: 'Tu as déjà 79,2 kg aujourd’hui. Remplacer par 78,9 kg ?' });
    await user.click(within(dialog).getByRole('button', { name: 'Annuler' }));
    expect(await getWeight('2026-10-03')).toMatchObject({ weightKg: 79.2 });

    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Remplacer' }));
    await waitFor(async () => {
      expect(await getWeight('2026-10-03')).toMatchObject({ weightKg: 78.9 });
    });
    expect(await listWeights()).toHaveLength(11);
  });

  it('avertissement doux (> 5 kg d’écart) : « Corriger » n’écrit rien, « Oui, enregistrer » écrit', async () => {
    const user = renderAt('#/weight');
    await user.type(await screen.findByLabelText('Poids du jour en kg'), '86,7');
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    const dialog = await screen.findByRole('dialog', { name: 'C’est bien ça ?' });
    expect(within(dialog).getByText('86,7 kg, soit +6,1 kg par rapport à la pesée précédente (80,6 kg le 1 oct.).')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Corriger' }));
    expect(await getWeight('2026-10-03')).toBeUndefined();
    expect(todayInput()).toHaveValue('86,7');

    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await user.click(within(await screen.findByRole('dialog', { name: 'C’est bien ça ?' })).getByRole('button', { name: 'Oui, enregistrer' }));
    await waitFor(async () => {
      expect(await getWeight('2026-10-03')).toMatchObject({ weightKg: 86.7 });
    });
  });
});

describe('Bouton « + » : pesée à une date passée', () => {
  beforeEach(seedWeights);

  it('ajout daté dans le passé ; date future refusée ; date existante → remplacement confirmé', async () => {
    const user = renderAt('#/weight');
    await user.click(await screen.findByRole('button', { name: 'Ajouter une pesée' }));
    let sheet = await screen.findByRole('dialog', { name: 'Ajouter une pesée' });
    const date = within(sheet).getByLabelText('Date de la pesée');
    expect(date).toHaveAttribute('max', '2026-10-03');
    expect(date).toHaveValue('2026-10-03');

    // Date future (contournement du max) : refusée avec un message clair.
    fireEvent.change(date, { target: { value: '2026-10-04' } });
    await user.type(within(sheet).getByLabelText('Poids en kg'), '80');
    await user.click(within(sheet).getByRole('button', { name: 'Ajouter' }));
    expect(await within(sheet).findByText('Une pesée ne peut pas être datée dans le futur.')).toBeInTheDocument();
    expect(await getWeight('2026-10-04')).toBeUndefined();

    fireEvent.change(date, { target: { value: '2026-09-30' } });
    await user.click(within(sheet).getByRole('button', { name: 'Ajouter' }));
    expect(await screen.findByText('Pesée enregistrée : 80 kg (mercredi 30 septembre).')).toBeInTheDocument();
    expect(await getWeight('2026-09-30')).toMatchObject({ weightKg: 80 });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // Date qui a déjà une pesée (1er octobre, 80,6 kg).
    await user.click(screen.getByRole('button', { name: 'Ajouter une pesée' }));
    sheet = await screen.findByRole('dialog', { name: 'Ajouter une pesée' });
    fireEvent.change(within(sheet).getByLabelText('Date de la pesée'), { target: { value: '2026-10-01' } });
    await user.type(within(sheet).getByLabelText('Poids en kg'), '80,5');
    await user.click(within(sheet).getByRole('button', { name: 'Ajouter' }));
    const confirm = await screen.findByRole('dialog', { name: 'Tu as déjà 80,6 kg ce jour-là. Remplacer par 80,5 kg ?' });
    await user.click(within(confirm).getByRole('button', { name: 'Remplacer' }));
    await waitFor(async () => {
      expect(await getWeight('2026-10-01')).toMatchObject({ weightKg: 80.5 });
    });
  });
});

describe('Liste : crayon (poids seul) et poubelle (confirmation)', () => {
  beforeEach(seedWeights);

  it('liste récente d’abord ; modifier le poids garde la date', async () => {
    const user = renderAt('#/weight');
    await screen.findByRole('figure');
    expect(listRows()[0]).toContain('jeudi 1 octobre');
    expect(listRows()[0]).toContain('80,6 kg');
    expect(listRows().at(-1)).toContain('mercredi 2 septembre');

    await user.click(screen.getByRole('button', { name: 'Modifier le poids du jeudi 1 octobre' }));
    const sheet = await screen.findByRole('dialog', { name: 'Modifier la pesée' });
    expect(within(sheet).queryByLabelText('Date de la pesée')).not.toBeInTheDocument();
    const field = within(sheet).getByLabelText('Poids en kg');
    expect(field).toHaveValue('80,6');
    await user.clear(field);
    await user.type(field, '80,55');
    await user.click(within(sheet).getByRole('button', { name: 'Enregistrer la correction' }));
    expect(await screen.findByText('Pesée corrigée : 80,55 kg (jeudi 1 octobre).')).toBeInTheDocument();
    expect(await getWeight('2026-10-01')).toMatchObject({ date: '2026-10-01', weightKg: 80.55, recordedAt: '2026-10-03T12:00:00+02:00' });
    expect(await listWeights()).toHaveLength(10);
  });

  it('supprimer : Annuler conserve, Supprimer retire ; stats et graphique recalculés', async () => {
    const user = renderAt('#/weight');
    expect(await screen.findByRole('figure')).toHaveAttribute('aria-label', 'Courbe du poids — 10 pesées');
    expect(statValue('Max')).toBe('82,4 kg');

    await user.click(screen.getByRole('button', { name: 'Supprimer la pesée du mercredi 2 septembre' }));
    let dialog = await screen.findByRole('dialog', { name: 'Supprimer la pesée du mercredi 2 septembre (82,4 kg) ?' });
    await user.click(within(dialog).getByRole('button', { name: 'Annuler' }));
    expect(await getWeight('2026-09-02')).toBeDefined();

    await user.click(screen.getByRole('button', { name: 'Supprimer la pesée du mercredi 2 septembre' }));
    dialog = await screen.findByRole('dialog', { name: /^Supprimer la pesée du mercredi 2 septembre/ });
    await user.click(within(dialog).getByRole('button', { name: 'Supprimer' }));
    expect(await screen.findByText('Pesée du mercredi 2 septembre supprimée.')).toBeInTheDocument();
    await waitFor(() => {
      expect(chartLabel()).toBe('Courbe du poids — 9 pesées');
    });
    expect(statValue('Max')).toBe('82,1 kg');
    expect(await getWeight('2026-09-02')).toBeUndefined();
  });
});

describe('Graphique, périodes, carte de détail, statistiques', () => {
  beforeEach(seedWeights);

  it('stats : dernier poids et écart, min, max, variation sur la période', async () => {
    renderAt('#/weight');
    await screen.findByRole('figure');
    expect(screen.getByText('−0,2 kg depuis le 28 sept.')).toBeInTheDocument();
    expect(statValue('Min')).toBe('80,6 kg');
    expect(statValue('Max')).toBe('82,4 kg');
    expect(statValue('Variation')).toBe('−1,8 kg');
    expect(screen.getByText('sur 29 jours')).toBeInTheDocument();
    expect(screen.getByText('10 pesées sur la période')).toBeInTheDocument();
  });

  it('périodes : 1M retire la pesée du 2 sept. ; Tout les montre toutes', async () => {
    const user = renderAt('#/weight');
    await screen.findByRole('figure');
    await user.click(screen.getByRole('button', { name: '1 mois' }));
    expect(chartLabel()).toBe('Courbe du poids — 9 pesées');
    expect(statValue('Max')).toBe('82,1 kg');
    expect(window.location.hash).toContain('periode=1M');
    await user.click(screen.getByRole('button', { name: 'Tout l’historique' }));
    expect(chartLabel()).toBe('Courbe du poids — 10 pesées');
  });

  it('toucher un point : carte (date, poids, écart avec la précédente, crayon)', async () => {
    const user = renderAt('#/weight');
    await screen.findByRole('figure');
    await user.click(screen.getByRole('button', { name: 'Pesée du vendredi 25 septembre : 80,95 kg' }));
    const card = await screen.findByText('vendredi 25 septembre', { selector: 'p' });
    const region = card.closest('section') ?? document.body;
    expect(within(region).getByText('80,95 kg')).toBeInTheDocument();
    expect(within(region).getByText('−0,25 kg depuis le 22 sept.')).toBeInTheDocument();
    await user.click(within(region).getByRole('button', { name: 'Modifier le poids du vendredi 25 septembre' }));
    expect(await screen.findByRole('dialog', { name: 'Modifier la pesée' })).toBeInTheDocument();
  });

  it('points serrés : le toucher choisit le point le plus proche du doigt, pas la zone dessinée au-dessus', async () => {
    renderAt('#/weight');
    const figure = await screen.findByRole('figure');
    // jsdom ne calcule pas la mise en page : le graphique est placé en (0, 0), à l'échelle 1.
    vi.spyOn(SVGElement.prototype, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 340, height: 220, right: 340, bottom: 220, x: 0, y: 0, toJSON: () => ({}) });
    const dot = (date: string) => figure.querySelector(`circle[data-point-id="${date}"]`);
    const target = dot('2026-09-25');
    const cx = Number(target?.getAttribute('cx'));
    const cy = Number(target?.getAttribute('cy'));
    // Le doigt se pose sur le 25 sept., mais c'est la zone tactile du 1er oct. (au-dessus) qui reçoit l'événement.
    const topmost = screen.getByRole('button', { name: 'Pesée du jeudi 1 octobre : 80,6 kg' });
    fireEvent.click(topmost, { clientX: cx + 1, clientY: cy });
    expect(await screen.findByText('vendredi 25 septembre', { selector: 'p' })).toBeInTheDocument();
    // Sans coordonnées (clavier, lecteur d'écran) : le point activé lui-même.
    fireEvent.click(screen.getByRole('button', { name: 'Pesée du jeudi 1 octobre : 80,6 kg' }));
    expect(await screen.findByText('jeudi 1 octobre', { selector: 'p' })).toBeInTheDocument();
  });

  it('ordonnée ajustée à la plage des données : 80,6 → 82,4 kg occupe plus de la moitié de la hauteur', async () => {
    renderAt('#/weight');
    const figure = await screen.findByRole('figure');
    // Ordonnées de la courbe (attribut d) : depuis zéro, 1,8 kg d'écart tiendrait en quelques pixels.
    const d = figure.querySelector('path.recharts-line-curve')?.getAttribute('d') ?? '';
    const ys = [...d.matchAll(/[ML][\d.]+,([\d.]+)/g)].map((m) => Number(m[1]));
    expect(ys).toHaveLength(10);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(220 / 2 - 30);
  });
});

describe('Accessibilité de l’écran Poids', () => {
  it('chaque bouton, lien, champ et point a un nom accessible (écran, feuille, carte)', async () => {
    await seedWeights();
    const user = renderAt('#/weight');
    await screen.findByRole('figure');
    const unnamed = () =>
      [...document.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [role="button"]')]
        .filter((el) => computeAccessibleName(el).trim() === '')
        .map((el) => el.outerHTML.slice(0, 100));
    expect(unnamed()).toEqual([]);
    expect(screen.getByRole('group', { name: 'Période' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Pesée du jeudi 1 octobre : 80,6 kg' }));
    expect(unnamed()).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Ajouter une pesée' }));
    await screen.findByRole('dialog', { name: 'Ajouter une pesée' });
    expect(unnamed()).toEqual([]);
  });
});

describe('Fuseau horaire : la pesée du jour prend la date LOCALE', () => {
  afterEach(() => {
    process.env.TZ = TEST_TIME_ZONE;
  });

  it('UTC+14 : à 12:30 UTC le 3 octobre, la pesée est datée du 4 octobre', async () => {
    process.env.TZ = 'Pacific/Kiritimati';
    vi.setSystemTime(new Date(Date.UTC(2026, 9, 3, 12, 30)));
    const user = renderAt('#/weight');
    await user.type(await screen.findByLabelText('Poids du jour en kg'), '80');
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(async () => {
      expect(await listWeights()).toEqual([{ date: '2026-10-04', weightKg: 80, recordedAt: '2026-10-04T02:30:00+14:00' }]);
    });
  });

  it('Los Angeles : à 05:30 UTC le 4 octobre, la pesée est datée du 3 octobre', async () => {
    process.env.TZ = 'America/Los_Angeles';
    vi.setSystemTime(new Date(Date.UTC(2026, 9, 4, 5, 30)));
    const user = renderAt('#/weight');
    await user.type(await screen.findByLabelText('Poids du jour en kg'), '80');
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(async () => {
      expect(await listWeights()).toEqual([{ date: '2026-10-03', weightKg: 80, recordedAt: '2026-10-03T22:30:00-07:00' }]);
    });
  });
});
