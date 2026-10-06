// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from '../../app/App';
import { previewRestore, restoreBackup } from '../../services/importService';
import { readFixture, resetDatabase } from '../../test/fixtures';

const example = (name: string) => readFileSync(resolve(process.cwd(), 'examples', name), 'utf8');

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

const upload = async (user: ReturnType<typeof userEvent.setup>, text: string) => {
  await user.upload(screen.getByLabelText('Choisir un fichier de sauvegarde (.json)'), new File([text], 'b.json'));
  return screen.findByRole('dialog', { name: 'Restaurer cette sauvegarde ?' });
};

beforeEach(resetDatabase);
afterEach(cleanup);

describe('Restauration : mensurations dans le résumé (V1.5.0)', () => {
  it('nombre de mensurations du fichier affiché, sans avertissement', async () => {
    await restoreText(readFixture('history-example.json'));
    const user = renderAt('#/settings');
    await screen.findByText(/1 programme et 3 séances/);
    const dialog = await upload(user, example('history-measurements-example.json'));
    expect(within(dialog).getByText('Mensurations').nextElementSibling).toHaveTextContent('5');
    expect(within(dialog).getByText('Version du schéma').nextElementSibling).toHaveTextContent('1.2');
    expect(within(dialog).queryByText(/ne contient aucune mensuration/)).not.toBeInTheDocument();
  });

  it('fichier SANS mensurations alors que l’app en contient : avertissement explicite', async () => {
    await restoreText(example('history-measurements-example.json'));
    const user = renderAt('#/settings');
    await screen.findByText(/1 programme, 3 séances et 10 pesées/);
    const dialog = await upload(user, example('history-weights-example.json'));
    expect(within(dialog).getByText('Mensurations').nextElementSibling).toHaveTextContent('0');
    expect(
      within(dialog).getByText(
        'Cette sauvegarde ne contient aucune mensuration : tes 5 mensurations actuelles seront remplacées (une copie de sécurité est conservée).',
      ),
    ).toBeInTheDocument();
    // Les pesées sont présentes dans le fichier : pas d'avertissement pour elles.
    expect(within(dialog).queryByText(/ne contient aucune pesée/)).not.toBeInTheDocument();
  });
});
