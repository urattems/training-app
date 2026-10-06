// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../app/App';
import { previewRestore, restoreBackup } from '../../services/importService';
import { addMeasurement } from '../../services/measurementService';
import { resetDatabase } from '../../test/fixtures';

const MEASUREMENTS = readFileSync(resolve(process.cwd(), 'examples', 'history-measurements-example.json'), 'utf8');
const NONE = { chestCm: null, bellyCm: null, waistCm: null, bicepsCm: null, thighCm: null, calfCm: null };

async function seed() {
  const preview = previewRestore(MEASUREMENTS);
  if (!preview.ok) throw new Error(preview.error.message);
  await restoreBackup(preview.value.data);
}

function renderAt(hash: string) {
  window.location.hash = hash;
  const user = userEvent.setup();
  render(<App />);
  return user;
}

const chartLabel = () => screen.getByRole('figure').getAttribute('aria-label');
const summary = () => (screen.getByText(/^Statistiques — /).closest('section') as HTMLElement);
const summaryValue = (label: string) => within(summary()).getByText(label, { selector: 'dt' }).nextElementSibling?.textContent;
const selector = (zone: string) => screen.getByRole('button', { name: new RegExp(`^Afficher le graphique : ${zone} `) });
const period = (name: string) => within(screen.getByRole('group', { name: 'Période' })).getByRole('button', { name });

beforeEach(async () => {
  // Seul Date est simulé : « aujourd'hui » = mardi 6 octobre 2026, midi.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 6, 12, 0, 0));
  await resetDatabase();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Un graphique à la fois, sélectionné par la carte « Dernière mensuration »', () => {
  beforeEach(seed);

  it('par défaut : Ventre, période Tout ; Départ / Aujourd’hui / Variation sur toutes les prises', async () => {
    renderAt('#/weight/mensurations');
    await screen.findByRole('figure');
    expect(selector('Ventre')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getAllByRole('button', { pressed: true }).filter((b) => b.getAttribute('aria-label')?.startsWith('Afficher'))).toHaveLength(1);
    expect(period('Tout l’historique')).toHaveAttribute('aria-pressed', 'true');
    expect(within(screen.getByRole('group', { name: 'Période' })).queryByRole('button', { name: '1 mois' })).not.toBeInTheDocument();
    expect(chartLabel()).toBe('Ventre — 5 prises');
    expect(summaryValue('Départ')).toBe('97 cm');
    expect(summaryValue('Aujourd’hui')).toBe('92 cm');
    expect(summaryValue('Variation')).toBe('−5 cm'); // vrai signe moins
  });

  it('sélection d’une zone : graphique, résumé et URL (?zone=) ; la sélection se voit sans la couleur', async () => {
    const user = renderAt('#/weight/mensurations');
    await screen.findByRole('figure');
    await user.click(selector('Taille'));
    await waitFor(() => {
      expect(window.location.hash).toContain('zone=taille');
    });
    expect(selector('Taille')).toHaveAttribute('aria-pressed', 'true');
    expect(selector('Ventre')).toHaveAttribute('aria-pressed', 'false');
    expect(chartLabel()).toBe('Taille — 3 prises'); // pas de taille le 30 mars ni le 1er sept.
    expect(summaryValue('Départ')).toBe('93,5 cm');
    expect(summaryValue('Variation')).toBe('−5,2 cm');
    // Indication non basée sur la couleur : coche visible et classe dédiée sur la ligne choisie.
    expect(selector('Taille').querySelector('svg')?.getAttribute('class')).toMatch(/checkOn/);
    expect(selector('Ventre').querySelector('svg')?.getAttribute('class')).toMatch(/checkOff/);
  });

  it('Total des mensurations : dernière ligne ; prises COMPLÈTES seulement', async () => {
    const user = renderAt('#/weight/mensurations');
    await screen.findByRole('figure');
    const card = (screen.getByText('Dernière mensuration').closest('section') as HTMLElement);
    const labels = within(card).getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? '');
    expect(labels.at(-1)).toMatch(/^Afficher le graphique : Total des mensurations \(418 cm\)$/);
    await user.click(selector('Total des mensurations'));
    expect(chartLabel()).toBe('Total des mensurations — 3 prises');
    expect(summaryValue('Départ')).toBe('431,2 cm');
    expect(summaryValue('Aujourd’hui')).toBe('418 cm');
    expect(summaryValue('Variation')).toBe('−13,2 cm');
  });

  it('période : moins de points, mais Départ inchangé (toujours sur toutes les prises)', async () => {
    const user = renderAt('#/weight/mensurations');
    await screen.findByRole('figure');
    await user.click(period('3 mois'));
    await waitFor(() => {
      expect(window.location.hash).toContain('periode=3M');
    });
    expect(chartLabel()).toBe('Ventre — 2 prises');
    expect(summaryValue('Départ')).toBe('97 cm');
    expect(within(summary()).getByText('2 prises sur la période')).toBeInTheDocument();
  });

  it('état gardé dans l’URL ; paramètre propre (1M de Poids ignoré → Tout)', async () => {
    renderAt('#/weight/mensurations?zone=mollet&periode=1A');
    await screen.findByRole('figure');
    expect(selector('Mollet')).toHaveAttribute('aria-pressed', 'true');
    expect(period('1 an')).toHaveAttribute('aria-pressed', 'true');
    cleanup();
    renderAt('#/weight/mensurations?periode=1M');
    await screen.findByRole('figure');
    expect(period('Tout l’historique')).toHaveAttribute('aria-pressed', 'true');
  });

  it('toucher un point : carte de détail (date, mesure, écart neutre, modifier)', async () => {
    const user = renderAt('#/weight/mensurations');
    await screen.findByRole('figure');
    await user.click(screen.getByRole('button', { name: 'mardi 29 septembre : 92 cm' }));
    const card = (await screen.findByText('mardi 29 septembre', { selector: 'p' })).closest('section') as HTMLElement;
    expect(card).toHaveTextContent('Mesure92 cm');
    expect(card).toHaveTextContent(/Écart : −0,5 cm depuis le 1 sept/);
    await user.click(within(card).getByRole('button', { name: 'Modifier la prise du mardi 29 septembre' }));
    expect(await screen.findByRole('dialog', { name: 'Modifier la prise' })).toBeInTheDocument();
  });

  it('jamais de rouge ni de vert : aucune classe de jugement dans le résumé, la sélection et le détail', async () => {
    const user = renderAt('#/weight/mensurations');
    await screen.findByRole('figure');
    await user.click(screen.getByRole('button', { name: 'mardi 29 septembre : 92 cm' }));
    const judged = /delta(Up|Down)|positive|negative|success|danger|warning|green|red\b/i;
    const elements = [...document.querySelectorAll('main *')];
    expect(elements.length).toBeGreaterThan(100); // le test ne passe pas « à vide »
    const classes = elements.map((el) => el.getAttribute('class') ?? '').filter((c) => judged.test(c));
    // Seule la poubelle de l'historique porte une classe « danger » (action destructive, pas un jugement).
    expect(classes.every((c) => /rowDelete/.test(c))).toBe(true);
  });
});

describe('Période sans point', () => {
  it('« Aucune prise sur cette période » et un lien pour passer à Tout', async () => {
    await addMeasurement('2025-11-15', { ...NONE, bellyCm: 97 }, new Date(2026, 9, 6, 12));
    const user = renderAt('#/weight/mensurations?periode=3M');
    expect(await screen.findByText('Aucune prise sur cette période.')).toBeInTheDocument();
    expect(screen.queryByRole('figure')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Voir tout l’historique' }));
    expect(await screen.findByRole('figure')).toBeInTheDocument();
    expect(period('Tout l’historique')).toHaveAttribute('aria-pressed', 'true');
    // Une seule valeur : variation « — ».
    expect(summaryValue('Variation')).toBe('—');
  });
});
