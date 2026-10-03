// @vitest-environment jsdom
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { computeAccessibleName } from 'dom-accessibility-api';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfirmSheet } from '../components/ConfirmSheet';
import { Sheet } from '../components/Sheet';
import { parseHistoryJson } from '../schemas/parse';
import { restoreBackup } from '../services/importService';
import { startWorkout } from '../services/workoutService';
import { readFixture, resetDatabase } from '../test/fixtures';
import { App } from './App';

afterEach(cleanup);

/** Deux niveaux de feuilles, comme « Abandonner » → « Supprimer cette séance vide ». */
function Harness() {
  const [first, setFirst] = useState(false);
  const [second, setSecond] = useState(false);
  return (
    <div id="root">
      <button type="button" onClick={() => { setFirst(true); }}>
        Ouvrir
      </button>
      <button type="button">Derrière</button>
      {first && (
        <Sheet
          title="Première feuille"
          onClose={() => { setFirst(false); }}
          footer={
            <>
              <button type="button" onClick={() => { setSecond(true); }}>
                Imbriquer
              </button>
              <button type="button" onClick={() => { setFirst(false); }}>
                Fermer
              </button>
            </>
          }
        >
          <p>Contenu</p>
        </Sheet>
      )}
      {second && (
        <ConfirmSheet title="Seconde feuille" confirmLabel="Confirmer" onConfirm={() => { setSecond(false); }} onCancel={() => { setSecond(false); }}>
          <p>Confirmation</p>
        </ConfirmSheet>
      )}
    </div>
  );
}

describe('Feuilles modales (Sheet, ConfirmSheet)', () => {
  it('rôle dialog, aria-modal, libellé par le titre ; focus dans la feuille ; fond inerte', async () => {
    const user = userEvent.setup();
    const { container } = render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Ouvrir' }));
    const dialog = screen.getByRole('dialog', { name: 'Première feuille' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveFocus();
    expect(container.querySelector('#root')).toHaveAttribute('inert');
  });

  it('focus piégé : Tab et Maj+Tab restent dans la feuille', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Ouvrir' }));
    const dialog = screen.getByRole('dialog');
    const [imbriquer, fermer] = within(dialog).getAllByRole('button');
    await user.tab();
    expect(imbriquer).toHaveFocus();
    await user.tab();
    expect(fermer).toHaveFocus();
    await user.tab();
    expect(imbriquer).toHaveFocus();
    await user.tab({ shift: true });
    expect(fermer).toHaveFocus();
  });

  it('Échap ferme la feuille et rend le focus au déclencheur ; le fond redevient actif', async () => {
    const user = userEvent.setup();
    const { container } = render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Ouvrir' });
    await user.click(trigger);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(container.querySelector('#root')).not.toHaveAttribute('inert');
  });

  it('feuilles imbriquées : Échap ne ferme que celle du dessus', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Ouvrir' }));
    await user.click(screen.getByRole('button', { name: 'Imbriquer' }));
    expect(screen.getAllByRole('dialog')).toHaveLength(2);
    await user.keyboard('{Escape}');
    expect(screen.getAllByRole('dialog').map((d) => d.getAttribute('aria-labelledby') && computeAccessibleName(d))).toEqual(['Première feuille']);
    expect(screen.getByRole('button', { name: 'Imbriquer' })).toHaveFocus();
  });
});

/** Chaque bouton, lien et champ visible doit avoir un nom accessible non vide. */
function expectAllNamed() {
  const elements = [...document.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [role="button"]')];
  const unnamed = elements.filter((el) => computeAccessibleName(el).trim() === '').map((el) => el.outerHTML.slice(0, 120));
  expect(unnamed).toEqual([]);
  return elements.length;
}

describe('Noms accessibles sur les écrans principaux', () => {
  beforeEach(async () => {
    await resetDatabase();
    const parsed = parseHistoryJson(readFixture('history-example.json'));
    if (!parsed.ok) throw new Error();
    await restoreBackup(parsed.value);
  });

  it.each([
    ['accueil', '#/', 'Commencer la séance'],
    ['programme', '#/program', 'Séance A'],
    ['détail du programme', '#/program/A', 'Commencer cette séance'],
    ['historique', '#/history', 'Historique'],
    ['détail historique', '#/history/w-0002', 'Supprimer la séance'],
    ['progression', '#/progress?periode=all', 'Historique récent'],
    ['paramètres', '#/settings', 'Exporter mes données'],
  ])('%s', async (_, hash, marker) => {
    window.location.hash = hash;
    render(<App />);
    await screen.findAllByText(marker);
    await waitFor(() => {
      expect(expectAllNamed()).toBeGreaterThan(0);
    });
  });

  it('écran séance et écran exercice (boutons icônes ← → Liste, champs de saisie)', async () => {
    const workout = await startWorkout('A');
    window.location.hash = `#/workout/${workout.id}/exercise/chest-press-machine`;
    render(<App />);
    await screen.findByText('Exercice 1 sur 2');
    expect(screen.getByRole('link', { name: 'Exercice suivant' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Liste des exercices de la séance' })).toBeInTheDocument();
    expectAllNamed();
    cleanup();
    window.location.hash = `#/workout/${workout.id}`;
    render(<App />);
    await screen.findByRole('button', { name: 'Terminer la séance' });
    await act(async () => {
      await Promise.resolve();
    });
    expectAllNamed();
  });
});

/** Fichiers CSS du projet. */
function cssFiles(dir = resolve(process.cwd(), 'src')): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return cssFiles(path);
    return name.endsWith('.css') ? [path] : [];
  });
}

describe('Mouvement réduit et focus visible (CSS)', () => {
  const files = cssFiles().map((path) => ({ path, css: readFileSync(path, 'utf8') }));

  it('toute animation est neutralisée sous prefers-reduced-motion', () => {
    const animated = files.filter(({ css }) => /animation:\s*(?!none)/.test(css));
    expect(animated.length).toBeGreaterThan(0);
    for (const { path, css } of animated) expect(css, path).toContain('prefers-reduced-motion');
  });

  it('les transitions utilisent les durées des tokens (ramenées à 0 sous mouvement réduit)', () => {
    const tokens = files.find(({ path }) => path.endsWith('tokens.css'))?.css ?? '';
    expect(tokens).toMatch(/prefers-reduced-motion: reduce\)\s*\{\s*:root\s*\{\s*--duration-fast: 0ms;\s*--duration-normal: 0ms;/);
    for (const { path, css } of files) {
      for (const match of css.matchAll(/transition:([^;]+);/g)) {
        expect(match[1], path).not.toMatch(/\d+m?s/);
      }
    }
  });

  it('focus visible global, et chaque « outline: none » a un indicateur de remplacement', () => {
    const base = files.find(({ path }) => path.endsWith('base.css'))?.css ?? '';
    expect(base).toMatch(/:focus-visible\s*\{[^}]*box-shadow: var\(--focus-ring\)/);
    for (const { path, css } of files) {
      for (const block of css.matchAll(/([^{}]+)\{([^{}]*outline:\s*none[^{}]*)\}/g)) {
        const [, selector = '', body = ''] = block;
        const replaced = /box-shadow|stroke|border-color/.test(body) || css.includes(`${selector.trim().split(':')[0] ?? ''}:focus-visible`);
        expect(replaced, `${path} → ${selector.trim()}`).toBe(true);
      }
    }
  });
});
