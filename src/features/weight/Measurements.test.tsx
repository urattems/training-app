// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { computeAccessibleName } from 'dom-accessibility-api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../app/App';
import { db } from '../../db/database';
import { previewRestore, restoreBackup } from '../../services/importService';
import { getMeasurement, listMeasurements } from '../../services/measurementService';
import { dumpDatabase, resetDatabase } from '../../test/fixtures';
import { formatDayShort } from '../../utils/format';

const MEASUREMENTS = readFileSync(resolve(process.cwd(), 'examples', 'history-measurements-example.json'), 'utf8');

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

const field = (zone: string) => screen.getByLabelText(`${zone} en cm`);
const saveButton = () => within(screen.getByRole('dialog')).getByRole('button', { name: 'Enregistrer' });
async function openNew(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Nouvelle mensuration' }));
  return screen.findByRole('dialog', { name: 'Nouvelle mensuration' });
}

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

describe('Sous-onglets [ Poids | Mensurations ]', () => {
  it('deux liens, aria-current sur la vue affichée ; titre « Poids » ; onglet de la barre actif sur les deux', async () => {
    const user = renderAt('#/weight');
    const tabs = await screen.findByRole('navigation', { name: 'Poids ou mensurations' });
    const nav = screen.getByRole('navigation', { name: 'Navigation principale' });
    expect(within(tabs).getAllByRole('link').map((l) => l.textContent)).toEqual(['Poids', 'Mensurations']);
    expect(within(tabs).getByRole('link', { name: 'Poids' })).toHaveAttribute('aria-current', 'page');
    expect(within(tabs).getByRole('link', { name: 'Mensurations' })).not.toHaveAttribute('aria-current');

    await user.click(within(tabs).getByRole('link', { name: 'Mensurations' }));
    await waitFor(() => {
      expect(window.location.hash).toBe('#/weight/mensurations');
    });
    await screen.findByRole('heading', { name: 'Aucune mensuration' }); // page Mensurations chargée
    expect(screen.getByRole('heading', { name: 'Poids', level: 1 })).toBeInTheDocument();
    const tabsAfter = screen.getByRole('navigation', { name: 'Poids ou mensurations' });
    expect(within(tabsAfter).getByRole('link', { name: 'Mensurations' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: 'Poids' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getAllByRole('link')).toHaveLength(4); // pas de 5ᵉ onglet
  });

  it('état vide sobre', async () => {
    renderAt('#/weight/mensurations');
    expect(await screen.findByRole('heading', { name: 'Aucune mensuration' })).toBeInTheDocument();
  });
});

describe('Nouvelle mensuration : saisie', () => {
  it('virgule acceptée ; champ vide = absent (null, jamais 0) ; date d’aujourd’hui par défaut', async () => {
    const user = renderAt('#/weight/mensurations');
    const dialog = await openNew(user);
    const date = within(dialog).getByLabelText('Date de la prise');
    expect(date).toHaveValue('2026-10-06');
    expect(date).toHaveAttribute('max', '2026-10-06');
    expect(saveButton()).toBeDisabled(); // aucune valeur
    await user.type(field('Ventre'), '92,5');
    expect(saveButton()).toBeEnabled();
    await user.click(saveButton());
    expect(await screen.findByText('Mensuration du mardi 6 octobre enregistrée.')).toBeInTheDocument();
    expect(await getMeasurement('2026-10-06')).toMatchObject({ chestCm: null, bellyCm: 92.5, waistCm: null, bicepsCm: null, thighCm: null, calfCm: null });
  });

  it('champs : clavier décimal, « OK », aucune aide repliable par champ ; aide et « Comment mesurer ? » replié', async () => {
    const user = renderAt('#/weight/mensurations');
    const dialog = await openNew(user);
    for (const zone of ['Poitrine', 'Ventre', 'Taille', 'Biceps', 'Cuisse', 'Mollet']) {
      expect(field(zone)).toHaveAttribute('inputmode', 'decimal');
      expect(field(zone)).toHaveAttribute('enterkeyhint', 'done');
    }
    expect(within(dialog).getByText('Mensurations prises relâchées, idéalement dans les mêmes conditions à chaque mesure.')).toBeInTheDocument();
    const details = dialog.querySelectorAll('details');
    expect(details).toHaveLength(1);
    expect(details[0]?.open).toBe(false);
    expect(within(dialog).getByText('Comment mesurer ?')).toBeInTheDocument();
    expect(within(dialog).getByText('Au niveau des tétons.')).toBeInTheDocument();
  });

  it.each([
    ['92,55', 'Ventre : au plus 1 décimale (ex. 98,5).'],
    ['0', 'Ventre : la mesure doit être supérieure à 0.'],
    ['301', 'Ventre : 300 cm au maximum.'],
    ['9a', 'Ventre : valeur illisible, chiffres uniquement (ex. 98,5).'],
  ])('refus de « %s » : message clair, jamais d’arrondi, rien d’écrit', async (text, message) => {
    const user = renderAt('#/weight/mensurations');
    await openNew(user);
    await user.type(field('Poitrine'), '104');
    await user.type(field('Ventre'), text);
    await user.click(saveButton());
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(field('Ventre')).toHaveValue(text);
    expect(await db.measurements.count()).toBe(0);
  });

  it.each(['91.234', '91,234'])('3ᵉ décimale (« %s ») : message sous le champ DÈS la frappe, pas un bouton grisé muet', async (text) => {
    const user = renderAt('#/weight/mensurations');
    await openNew(user);
    await user.type(field('Ventre'), '9,');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument(); // saisie en cours : aucun message
    await user.clear(field('Ventre'));
    await user.type(field('Ventre'), text);
    const message = screen.getByText('Ventre : au plus 1 décimale (ex. 98,5).');
    expect(message).toHaveAttribute('role', 'alert');
    expect(field('Ventre')).toHaveAttribute('aria-invalid', 'true');
    expect(field('Ventre').getAttribute('aria-describedby')).toBe(message.id);
    expect(saveButton()).toBeDisabled();
    expect(field('Ventre')).toHaveValue(text); // jamais d'arrondi ni de réécriture
    await user.clear(field('Ventre'));
    await user.type(field('Ventre'), '91,2');
    expect(screen.queryByText('Ventre : au plus 1 décimale (ex. 98,5).')).not.toBeInTheDocument();
    expect(saveButton()).toBeEnabled();
    expect(await db.measurements.count()).toBe(0);
  });

  it('date future refusée, rien d’écrit', async () => {
    const user = renderAt('#/weight/mensurations');
    const dialog = await openNew(user);
    fireEvent.change(within(dialog).getByLabelText('Date de la prise'), { target: { value: '2026-10-07' } });
    await user.type(field('Ventre'), '92');
    await user.click(saveButton());
    expect(await screen.findByText('La date ne peut pas être dans le futur.')).toBeInTheDocument();
    expect(await db.measurements.count()).toBe(0);
  });

  it('date passée autorisée', async () => {
    const user = renderAt('#/weight/mensurations');
    const dialog = await openNew(user);
    fireEvent.change(within(dialog).getByLabelText('Date de la prise'), { target: { value: '2026-08-15' } });
    await user.type(field('Mollet'), '38,5');
    await user.click(saveButton());
    await screen.findByText('Mensuration du samedi 15 août enregistrée.');
    expect((await listMeasurements()).map((m) => [m.date, m.calfCm])).toEqual([['2026-08-15', 38.5]]);
  });
});

describe('Avec des prises existantes', () => {
  beforeEach(seed);

  it('placeholder = dernière valeur de la zone, JAMAIS de préremplissage', async () => {
    const user = renderAt('#/weight/mensurations');
    await openNew(user);
    expect(field('Poitrine')).toHaveValue('');
    expect(field('Poitrine')).toHaveAttribute('placeholder', '104');
    expect(field('Ventre')).toHaveAttribute('placeholder', '92');
  });

  it('date déjà prise : message + « Modifier cette prise » (vraies valeurs) ; rien n’est écrasé', async () => {
    const before = await dumpDatabase();
    const user = renderAt('#/weight/mensurations');
    const dialog = await openNew(user);
    fireEvent.change(within(dialog).getByLabelText('Date de la prise'), { target: { value: '2026-09-29' } });
    expect(await within(dialog).findByText('Une prise existe déjà le mardi 29 septembre.')).toBeInTheDocument();
    await user.type(field('Ventre'), '80');
    expect(saveButton()).toBeDisabled();
    await user.click(within(dialog).getByRole('button', { name: 'Modifier cette prise' }));
    const edit = await screen.findByRole('dialog', { name: 'Modifier la prise' });
    expect(within(edit).queryByLabelText('Date de la prise')).not.toBeInTheDocument(); // date non modifiable
    expect(field('Poitrine')).toHaveValue('104');
    expect(field('Ventre')).toHaveValue('92');
    expect(field('Taille')).toHaveValue('88,3');
    expect(await dumpDatabase()).toEqual(before);
  });

  it('modifier une prise : valeurs réelles préremplies, date inchangée', async () => {
    const user = renderAt('#/weight/mensurations');
    await user.click(await screen.findByRole('button', { name: 'Modifier la prise du mardi 1 septembre' }));
    await screen.findByRole('dialog', { name: 'Modifier la prise' });
    expect(field('Ventre')).toHaveValue('92,5');
    expect(field('Poitrine')).toHaveValue('');
    await user.type(field('Poitrine'), '103,5');
    await user.click(saveButton());
    await screen.findByText('Prise du mardi 1 septembre modifiée.');
    expect(await getMeasurement('2026-09-01')).toMatchObject({ chestCm: 103.5, bellyCm: 92.5 });
  });

  it('avertissement doux des 10 cm : « Corriger » n’écrit rien, « Oui, enregistrer » écrit', async () => {
    const user = renderAt('#/weight/mensurations');
    await openNew(user);
    await user.type(field('Ventre'), '105');
    await user.click(saveButton());
    const sanity = await screen.findByRole('dialog', { name: 'C’est bien ça ?' });
    expect(within(sanity).getByText(`Ventre : 105 cm, contre 92 cm le ${formatDayShort('2026-09-29')}.`)).toBeInTheDocument();
    await user.click(within(sanity).getByRole('button', { name: 'Corriger' }));
    expect(await getMeasurement('2026-10-06')).toBeUndefined();
    await user.click(saveButton());
    await user.click(within(await screen.findByRole('dialog', { name: 'C’est bien ça ?' })).getByRole('button', { name: 'Oui, enregistrer' }));
    await screen.findByText('Mensuration du mardi 6 octobre enregistrée.');
    expect((await getMeasurement('2026-10-06'))?.bellyCm).toBe(105);
  });

  it('un écart de 10 cm pile ne déclenche rien', async () => {
    const user = renderAt('#/weight/mensurations');
    await openNew(user);
    await user.type(field('Ventre'), '102');
    await user.click(saveButton());
    await screen.findByText('Mensuration du mardi 6 octobre enregistrée.');
  });

  it('suppression : confirmation ; Annuler conserve, Supprimer retire', async () => {
    const user = renderAt('#/weight/mensurations');
    await user.click(await screen.findByRole('button', { name: 'Supprimer la prise du mardi 29 septembre' }));
    let confirm = await screen.findByRole('dialog', { name: 'Supprimer la prise du mardi 29 septembre ?' });
    await user.click(within(confirm).getByRole('button', { name: 'Annuler' }));
    expect(await getMeasurement('2026-09-29')).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Supprimer la prise du mardi 29 septembre' }));
    confirm = await screen.findByRole('dialog', { name: 'Supprimer la prise du mardi 29 septembre ?' });
    await user.click(within(confirm).getByRole('button', { name: 'Supprimer' }));
    await screen.findByText('Prise du mardi 29 septembre supprimée.');
    expect(await getMeasurement('2026-09-29')).toBeUndefined();
  });

  it('dernière mensuration : 6 zones (ou « — »), Total de la dernière prise COMPLÈTE avec sa date', async () => {
    renderAt('#/weight/mensurations');
    const card = (await screen.findByText('Dernière mensuration')).closest('section') as HTMLElement;
    const rows = within(card).getAllByRole('listitem').map((li) => li.textContent);
    expect(rows).toEqual([
      expect.stringMatching(/^Poitrine.*104 cm/),
      expect.stringMatching(/^Ventre.*92 cm/),
      expect.stringMatching(/^Taille.*88,3 cm/),
      expect.stringMatching(/^Biceps.*36,4 cm/),
      expect.stringMatching(/^Cuisse.*58,8 cm/),
      expect.stringMatching(/^Mollet.*38,5 cm/),
      expect.stringMatching(/^Total des mensurations.*418 cm/),
    ]);
    expect(within(card).getByText('Prise complète du mardi 29 septembre')).toBeInTheDocument();
  });

  it('historique : du plus récent au plus ancien ; Total si complète, sinon « Prise incomplète »', async () => {
    renderAt('#/weight/mensurations');
    const list = (await screen.findByText('Historique des prises')).closest('section') as HTMLElement;
    const rows = within(list).getAllByRole('listitem');
    expect(rows.map((r) => r.querySelector('span')?.textContent)).toEqual([
      'mardi 29 septembre',
      'mardi 1 septembre',
      'mercredi 1 juillet',
      'lundi 30 mars',
      'samedi 15 novembre 2025',
    ]);
    expect(rows[0]).toHaveTextContent('Total des mensurations : 418 cm');
    expect(rows[1]).toHaveTextContent('Prise incomplète');
    expect(rows[1]).toHaveTextContent('—');
  });
});

describe('Vocabulaire et accessibilité', () => {
  beforeEach(seed);

  it('jamais « score » ni « points » (page, feuille de saisie)', async () => {
    const user = renderAt('#/weight/mensurations');
    await screen.findByText('Dernière mensuration');
    const forbidden = /\bscores?\b|\bpoints\b/i;
    expect(document.body.textContent).not.toMatch(forbidden);
    await openNew(user);
    expect(document.body.textContent).not.toMatch(forbidden);
  });

  it('chaque bouton, lien et champ a un nom accessible ; zones tactiles de la liste', async () => {
    const user = renderAt('#/weight/mensurations');
    await screen.findByText('Dernière mensuration');
    const unnamed = () =>
      [...document.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, summary')]
        .filter((el) => computeAccessibleName(el).trim() === '')
        .map((el) => el.outerHTML.slice(0, 100));
    expect(unnamed()).toEqual([]);
    await openNew(user);
    expect(unnamed()).toEqual([]);
  });
});
