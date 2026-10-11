// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from '../../app/App';
import { db } from '../../db/database';
import { getDriveSync, MIN_SECRET_LENGTH, saveDriveConfig } from '../../services/driveSettings';
import { resetDatabase } from '../../test/fixtures';

/** Paramètres V1.8.0 : Drive en dernière position (§4.3) ; secret de 20 caractères à la saisie. */
const URL_ = 'https://script.google.com/macros/s/AKfycbV18TESTID/exec';

function renderAt(hash: string) {
  window.location.hash = hash;
  const user = userEvent.setup();
  render(<App />);
  return user;
}

beforeEach(resetDatabase);
afterEach(cleanup);

describe('Archive Drive en dernière position (§4.3)', () => {
  it('dernière section des Paramètres, titrée « Option avancée — facultatif », avec le guide pas à pas', async () => {
    renderAt('#/settings');
    await screen.findByRole('link', { name: 'Archive Drive' });
    const sections = [...document.querySelectorAll('main section[aria-labelledby]')].filter((s) => s.id === '' && s.getAttribute('aria-labelledby')?.startsWith('settings-'));
    const titles = sections.map((s) => document.getElementById(s.getAttribute('aria-labelledby') ?? '')?.textContent);
    expect(titles).toEqual(['Données', 'Préférences', 'Aide', 'Informations', 'Option avancée — facultatif']);
    const last = sections.at(-1) as HTMLElement;
    expect(within(last).getByRole('link', { name: 'Archive Drive' })).toHaveAttribute('href', '#/settings/drive');
    const guide = within(last).getByRole('link', { name: 'Guide pas à pas (GitHub)' });
    expect(guide).toHaveAttribute('href', 'https://github.com/urattems/training-app/blob/main/docs/guide-drive.md');
    expect(guide).toHaveAttribute('target', '_blank');
    // Plus d'entrée Drive dans « Données ».
    expect(within(sections[0] as HTMLElement).queryByRole('link', { name: 'Archive Drive' })).not.toBeInTheDocument();
    // Et c'est la toute dernière section de premier niveau de la page.
    const topLevel = [...document.querySelectorAll('main section')].filter((s) => s.parentElement?.closest('section') == null);
    expect(topLevel.at(-1)).toBe(last);
  });
});

describe('Secret Drive : 20 caractères au moins à la saisie (comme le script)', () => {
  it('19 caractères refusés, 20 acceptés', async () => {
    expect(MIN_SECRET_LENGTH).toBe(20);
    await expect(saveDriveConfig(URL_, 'a'.repeat(19))).rejects.toThrow('Le secret doit contenir au moins 20 caractères, comme dans le script.');
    expect(await db.settings.get('driveSync')).toBeUndefined();
    await expect(saveDriveConfig(URL_, 'b'.repeat(20))).resolves.toMatchObject({ url: URL_, secret: 'b'.repeat(20) });
  });

  it('configuration déjà enregistrée avec un secret court : ni effacée ni invalidée', async () => {
    const legacy = { url: URL_, secret: 'ancien-12car', enabled: true, testedAt: '2026-10-01T10:00:00+02:00' };
    await db.settings.put({ key: 'driveSync', value: legacy });
    // L'app démarre et l'écran Drive s'ouvre : rien n'est touché.
    renderAt('#/settings/drive');
    expect(await screen.findByText(/Secret enregistré : ••••2car/)).toBeInTheDocument();
    expect(await getDriveSync()).toEqual(legacy);
    // Réenregistrer en gardant le secret enregistré (champ vide) : accepté, rien ne change.
    await expect(saveDriveConfig(URL_, legacy.secret)).resolves.toEqual(legacy);
    expect(await getDriveSync()).toEqual(legacy);
    // Un NOUVEAU secret court, lui, est refusé ; l'ancienne configuration reste intacte.
    await expect(saveDriveConfig(URL_, 'nouveau-court')).rejects.toThrow('au moins 20');
    expect(await getDriveSync()).toEqual(legacy);
  });

  it('écran Drive : un secret de 19 caractères saisi affiche le message, rien n’est enregistré', async () => {
    const user = renderAt('#/settings/drive');
    await user.type(await screen.findByLabelText('Adresse du script (URL)'), URL_);
    await user.type(screen.getByLabelText('Secret'), 'c'.repeat(19));
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(await screen.findByText('Le secret doit contenir au moins 20 caractères, comme dans le script.')).toBeInTheDocument();
    expect(await db.settings.get('driveSync')).toBeUndefined();
  });
});
