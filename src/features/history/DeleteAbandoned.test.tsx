// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from '../../app/App';
import { db } from '../../db/database';
import { parseHistoryJson } from '../../schemas/parse';
import { restoreBackup } from '../../services/importService';
import { getWorkout } from '../../services/workoutService';
import { readFixture, resetDatabase } from '../../test/fixtures';

async function restoreFixture() {
  const parsed = parseHistoryJson(readFixture('history-example.json'));
  if (!parsed.ok) throw new Error(parsed.error.message);
  await restoreBackup(parsed.value);
}

function renderAt(hash: string) {
  window.location.hash = hash;
  const user = userEvent.setup();
  render(<App />);
  return user;
}

beforeEach(async () => {
  await resetDatabase();
  await restoreFixture();
});
afterEach(cleanup);

describe('Détail d’une séance abandonnée : « Supprimer cette séance » (alternative sans geste)', () => {
  it('confirmation : nom, date, séries saisies, caractère définitif ; Annuler ne change rien', async () => {
    const user = renderAt('#/history/w-0003');
    await screen.findByRole('heading', { name: 'Séance A', level: 1 });
    await user.click(screen.getByRole('button', { name: 'Supprimer cette séance' }));
    const dialog = await screen.findByRole('dialog', { name: 'Supprimer cette séance abandonnée ?' });
    expect(dialog).toHaveTextContent('« Séance A » du mardi 22 septembre : 2 séries saisies.');
    expect(dialog).toHaveTextContent('La suppression est définitive');
    expect(within(dialog).getByRole('button', { name: 'Supprimer' })).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Annuler' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(await getWorkout('w-0003')).not.toBeNull();
    expect(await getWorkout('w-0001')).not.toBeNull();
  });

  it('confirmer supprime exactement cette séance, retour à la liste mise à jour', async () => {
    const user = renderAt('#/history/w-0003');
    await screen.findByRole('heading', { name: 'Séance A', level: 1 });
    await user.click(screen.getByRole('button', { name: 'Supprimer cette séance' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Supprimer' }));
    await waitFor(() => {
      expect(window.location.hash).toBe('#/history');
    });
    await waitFor(() => {
      expect(within(screen.getByRole('list')).getAllByRole('link')).toHaveLength(2);
    });
    expect(await getWorkout('w-0003')).toBeNull();
    expect(await getWorkout('w-0001')).not.toBeNull();
    expect(await getWorkout('w-0002')).not.toBeNull();
  });

  it('séance TERMINÉE : bouton et confirmation inchangés (règle des autres statuts non modifiée)', async () => {
    const user = renderAt('#/history/w-0002');
    await screen.findByRole('heading', { name: 'Séance A', level: 1 });
    expect(screen.queryByRole('button', { name: 'Supprimer cette séance' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Supprimer la séance' }));
    const dialog = await screen.findByRole('dialog', { name: 'Supprimer cette séance ?' });
    expect(dialog).toHaveTextContent('sera définitivement supprimée');
    expect(within(dialog).getByRole('button', { name: 'Supprimer définitivement' })).toBeInTheDocument();
  });
});

// --- Balayage dans la liste (V1.3.3) --------------------------------------------------------

const rows = () => within(screen.getByRole('list')).getAllByRole('link');
const rowOf = (id: string) => {
  const item = document.querySelector(`[data-swipe-id="${id}"]`);
  const link = item?.querySelector('a');
  if (!item || !link) throw new Error(`ligne ${id} absente`);
  return { item, link, content: link.parentElement ?? link };
};
const isOpen = (id: string) => rowOf(id).item.querySelector('[data-open]') !== null;

/** Geste au doigt : appui, deux mouvements, relâchement (aucun clic, comme sur iPhone). */
function swipe(target: Element, dx: number, dy = 0) {
  const at = (x: number, y: number) => ({ clientX: x, clientY: y, pointerId: 1, pointerType: 'touch', isPrimary: true });
  fireEvent.pointerDown(target, at(200, 100));
  fireEvent.pointerMove(target, at(200 + dx / 2, 100 + dy / 2));
  fireEvent.pointerMove(target, at(200 + dx, 100 + dy));
  fireEvent.pointerUp(target, at(200 + dx, 100 + dy));
}

async function openList() {
  renderAt('#/history');
  await waitFor(() => {
    expect(rows()).toHaveLength(3);
  });
}

describe('Historique : balayage d’une séance abandonnée', () => {
  it('balayage à gauche : l’action « Supprimer » apparaît, rien n’est supprimé ni ouvert', async () => {
    await openList();
    swipe(rowOf('w-0003').content, -120);
    expect(isOpen('w-0003')).toBe(true);
    expect(rowOf('w-0003').content).toHaveStyle({ transform: 'translateX(-88px)' });
    expect(window.location.hash).toBe('#/history');
    expect(await getWorkout('w-0003')).not.toBeNull();
  });

  it('séance terminée : aucun balayage, aucune action', async () => {
    await openList();
    expect(screen.getAllByRole('button', { name: /^Supprimer la séance abandonnée/ })).toHaveLength(1);
    const { item, link } = rowOf('w-0002');
    swipe(link, -120);
    expect(item.querySelector('[data-open]')).toBeNull();
    expect(link.style.transform).toBe('');
    expect(within(item as HTMLElement).queryByRole('button')).toBeNull();
  });

  it('geste vertical = défilement : la ligne ne bouge pas ; petit geste sous le seuil : rien', async () => {
    await openList();
    swipe(rowOf('w-0003').content, -8, 60);
    expect(isOpen('w-0003')).toBe(false);
    expect(rowOf('w-0003').content.getAttribute('style') ?? '').not.toContain('translateX');
    swipe(rowOf('w-0003').content, -6, 0);
    expect(isOpen('w-0003')).toBe(false);
    // jsdom n'applique pas les CSS modules : la règle est vérifiée dans la feuille de style.
    expect(readFileSync(resolve(process.cwd(), 'src/features/history/SwipeRow.module.css'), 'utf8')).toMatch(/\.content \{[^}]*touch-action: pan-y;/);
  });

  it('balayage court (moins de la moitié) : la ligne revient fermée', async () => {
    await openList();
    swipe(rowOf('w-0003').content, -30);
    expect(isOpen('w-0003')).toBe(false);
  });

  it('tap sur la ligne fermée : ouvre toujours le détail', async () => {
    const user = userEvent.setup();
    await openList();
    swipe(rowOf('w-0003').content, -120);
    swipe(rowOf('w-0003').content, 120); // refermée par le balayage inverse
    expect(isOpen('w-0003')).toBe(false);
    await user.click(rowOf('w-0003').link);
    await waitFor(() => {
      expect(window.location.hash).toBe('#/history/w-0003');
    });
  });

  it('tap sur la ligne ouverte : la referme sans ouvrir le détail ; tap ailleurs : referme aussi', async () => {
    const user = userEvent.setup();
    await openList();
    swipe(rowOf('w-0003').content, -120);
    await user.click(rowOf('w-0003').link);
    expect(isOpen('w-0003')).toBe(false);
    expect(window.location.hash).toBe('#/history');

    swipe(rowOf('w-0003').content, -120);
    expect(isOpen('w-0003')).toBe(true);
    await user.click(rowOf('w-0001').link); // tap sur une autre ligne : referme seulement
    expect(isOpen('w-0003')).toBe(false);
    expect(window.location.hash).toBe('#/history');
    await user.click(rowOf('w-0001').link); // tap suivant : ouvre normalement
    await waitFor(() => {
      expect(window.location.hash).toBe('#/history/w-0001');
    });
  });

  it('une seule ligne ouverte à la fois', async () => {
    const w1 = await getWorkout('w-0001');
    if (!w1) throw new Error('w-0001');
    await db.workouts.put({ ...w1, status: 'abandoned' });
    await openList();
    swipe(rowOf('w-0003').content, -120);
    expect(isOpen('w-0003')).toBe(true);
    swipe(rowOf('w-0001').content, -120);
    await waitFor(() => {
      expect(isOpen('w-0003')).toBe(false);
    });
    expect(isOpen('w-0001')).toBe(true);
  });

  it('« Supprimer » → confirmation ; Annuler ne supprime rien ; confirmer supprime exactement cette séance', async () => {
    const user = userEvent.setup();
    await openList();
    swipe(rowOf('w-0003').content, -120);
    await user.click(screen.getByRole('button', { name: 'Supprimer la séance abandonnée « Séance A » du mardi 22 septembre' }));
    let dialog = await screen.findByRole('dialog', { name: 'Supprimer cette séance abandonnée ?' });
    expect(dialog).toHaveTextContent('2 séries saisies');
    await user.click(within(dialog).getByRole('button', { name: 'Annuler' }));
    expect(await getWorkout('w-0003')).not.toBeNull();
    expect(rows()).toHaveLength(3);

    await user.click(screen.getByRole('button', { name: /^Supprimer la séance abandonnée/ }));
    dialog = await screen.findByRole('dialog', { name: 'Supprimer cette séance abandonnée ?' });
    await user.click(within(dialog).getByRole('button', { name: 'Supprimer' }));
    await waitFor(() => {
      expect(rows()).toHaveLength(2);
    });
    expect(await getWorkout('w-0003')).toBeNull();
    expect(await getWorkout('w-0001')).not.toBeNull();
    expect(await getWorkout('w-0002')).not.toBeNull();
    expect(window.location.hash).toBe('#/history');
  });

  it('accessible sans geste : action nommée pour VoiceOver ; le focus clavier ouvre la ligne', async () => {
    await openList();
    const action = screen.getByRole('button', { name: 'Supprimer la séance abandonnée « Séance A » du mardi 22 septembre' });
    expect(isOpen('w-0003')).toBe(false);
    act(() => {
      action.focus();
    });
    expect(isOpen('w-0003')).toBe(true);
  });
});
