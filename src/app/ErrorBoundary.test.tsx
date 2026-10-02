// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db/database';
import { resetDatabase } from '../test/fixtures';
import { App } from './App';
import { ErrorBoundary, isDatabaseError } from './ErrorBoundary';

function Boom({ error }: { error: Error }): never {
  throw error;
}

beforeEach(async () => {
  await resetDatabase();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Filet de sécurité global (SPEC §7.9)', () => {
  it('erreur inattendue : message clair, rechargement, détails techniques sur demande', async () => {
    const user = userEvent.setup();
    render(
      <ErrorBoundary>
        <Boom error={new TypeError('x is undefined')} />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('heading', { name: 'Un problème est survenu' })).toBeInTheDocument();
    expect(screen.getByText(/Tes données enregistrées ne sont pas perdues/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Recharger l’app' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Afficher les détails' }));
    expect(screen.getByText('TypeError: x is undefined')).toBeInTheDocument();
  });

  it('base locale indisponible : reconnue même emballée par Dexie', () => {
    const missing = Object.assign(new Error('IndexedDB API missing'), { name: 'MissingAPIError' });
    const wrapped = Object.assign(new Error('open failed'), { name: 'DexieError', inner: missing });
    expect(isDatabaseError(missing)).toBe(true);
    expect(isDatabaseError(wrapped)).toBe(true);
    expect(isDatabaseError(new Error('autre', { cause: Object.assign(new Error('q'), { name: 'QuotaExceededError' }) }))).toBe(true);
    expect(isDatabaseError(new TypeError('x'))).toBe(false);
  });

  it('l\'app affiche « Base de données locale indisponible » si la lecture IndexedDB échoue', async () => {
    const failure = Object.assign(new Error('Database open failed'), { name: 'OpenFailedError' });
    vi.spyOn(db.settings, 'get').mockRejectedValue(failure);
    window.location.hash = '#/';
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Base de données locale indisponible' })).toBeInTheDocument();
    expect(screen.getByText(/navigation privée/)).toBeInTheDocument();
  });
});
