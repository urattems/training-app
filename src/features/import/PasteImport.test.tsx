// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../app/App';
import { importProgram, previewProgram } from '../../services/programService';
import { getActiveProgramId } from '../../services/settingsService';
import { dumpDatabase, fixtureObject, readFixture, resetDatabase } from '../../test/fixtures';

const program = readFixture('program-example.json');
const EMPTY_DB = { programs: [], workouts: [], settings: [], metadata: [] };

function renderAt(hash: string) {
  window.location.hash = hash;
  const user = userEvent.setup();
  render(<App />);
  return user;
}

/** Remplace le presse-papiers (userEvent installe le sien à chaque `setup`). */
function setClipboard(value: Partial<Clipboard> | undefined) {
  Object.defineProperty(window.navigator, 'clipboard', { value, configurable: true, writable: true });
}

async function openPaste(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Coller le JSON' }));
  return screen.findByRole('dialog', { name: 'Coller un programme' });
}

/** Colle du texte dans la zone (comme un appui long → Coller). */
async function pasteText(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement, text: string) {
  await user.click(within(dialog).getByLabelText('JSON du programme'));
  await user.paste(text);
}

beforeEach(resetDatabase);
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Coller un programme (V1.1a)', () => {
  it('premier lancement : collage valide → prévisualisation → rien d’écrit avant confirmation → import', async () => {
    const user = renderAt('#/');
    await screen.findByRole('heading', { name: 'Bienvenue' });
    const dialog = await openPaste(user);
    const area = within(dialog).getByLabelText('JSON du programme');
    // Saisie de code : ni majuscule auto, ni correction, ni orthographe.
    expect(area).toHaveAttribute('autocapitalize', 'off');
    expect(area).toHaveAttribute('autocorrect', 'off');
    expect(area).toHaveAttribute('spellcheck', 'false');
    expect(within(dialog).getByRole('button', { name: 'Vérifier' })).toBeDisabled();

    await pasteText(user, dialog, program);
    await user.click(within(dialog).getByRole('button', { name: 'Vérifier' }));

    const preview = await screen.findByRole('dialog', { name: 'Importer ce programme ?' });
    expect(within(preview).getByText('Programme semaine 40')).toBeInTheDocument();
    expect(await dumpDatabase()).toEqual(EMPTY_DB);

    await user.click(within(preview).getByRole('button', { name: 'Importer' }));
    await screen.findByRole('dialog', { name: 'Programme importé' });
    expect(await getActiveProgramId()).toBe('prog-2026-w40');
  });

  it('accepte une clôture Markdown ```json … ``` (Paramètres)', async () => {
    const user = renderAt('#/settings');
    const dialog = await openPaste(user);
    await pasteText(user, dialog, `\n\`\`\`json\n${program}\n\`\`\`\n`);
    await user.click(within(dialog).getByRole('button', { name: 'Vérifier' }));
    expect(await screen.findByRole('dialog', { name: 'Importer ce programme ?' })).toBeInTheDocument();
  });

  it('JSON invalide : message clair, détails à la demande, texte conservé pour correction, rien d’écrit', async () => {
    const user = renderAt('#/');
    const dialog = await openPaste(user);
    await pasteText(user, dialog, 'Voici ton programme : { "schemaVersion": "1.0" ');
    await user.click(within(dialog).getByRole('button', { name: 'Vérifier' }));

    const refused = await screen.findByRole('dialog', { name: 'Texte refusé' });
    expect(within(refused).getByRole('alert')).toHaveTextContent("Import impossible : le texte collé n'est pas du JSON valide.");
    await user.click(within(refused).getByRole('button', { name: 'Afficher les détails' }));
    expect(within(refused).getByRole('list')).toBeInTheDocument();

    await user.click(within(refused).getByRole('button', { name: 'Modifier le texte' }));
    const again = await screen.findByRole('dialog', { name: 'Coller un programme' });
    expect(within(again).getByLabelText('JSON du programme')).toHaveValue('Voici ton programme : { "schemaVersion": "1.0" ');
    expect(await dumpDatabase()).toEqual(EMPTY_DB);
  });

  it('programId déjà existant : refusé à la confirmation, base inchangée', async () => {
    const preview = previewProgram(program);
    if (!preview.ok) throw new Error(preview.error.message);
    await importProgram(preview.value.program);
    const before = await dumpDatabase();

    const user = renderAt('#/settings');
    const dialog = await openPaste(user);
    await pasteText(user, dialog, program);
    await user.click(within(dialog).getByRole('button', { name: 'Vérifier' }));
    await user.click(within(await screen.findByRole('dialog', { name: 'Importer ce programme ?' })).getByRole('button', { name: 'Importer' }));

    const refused = await screen.findByRole('dialog', { name: 'Texte refusé' });
    expect(within(refused).getByRole('alert')).toHaveTextContent(
      'Import impossible : un programme avec l\'identifiant « prog-2026-w40 » existe déjà. Demande au coach un nouvel identifiant.',
    );
    expect(await dumpDatabase()).toEqual(before);
  });

  it('clés inconnues signalées dans « Champs ignorés »', async () => {
    const withExtra = fixtureObject('program-example.json');
    withExtra.coachMood = 'motivé';
    const user = renderAt('#/');
    const dialog = await openPaste(user);
    await pasteText(user, dialog, `\`\`\`json\n${JSON.stringify(withExtra, null, 2)}\n\`\`\``);
    await user.click(within(dialog).getByRole('button', { name: 'Vérifier' }));
    const preview = await screen.findByRole('dialog', { name: 'Importer ce programme ?' });
    expect(within(preview).getByText('Champs ignorés : coachMood')).toBeInTheDocument();
  });

  it('« Coller depuis le presse-papiers » remplit la zone quand l’API répond', async () => {
    const user = renderAt('#/');
    setClipboard({ readText: () => Promise.resolve(program) });
    const dialog = await openPaste(user);
    await user.click(within(dialog).getByRole('button', { name: 'Coller depuis le presse-papiers' }));
    expect(within(dialog).getByLabelText('JSON du programme')).toHaveValue(program);
    expect(await dumpDatabase()).toEqual(EMPTY_DB);
  });

  it('presse-papiers refusé : aucune alerte, simple invitation à coller à la main', async () => {
    const user = renderAt('#/');
    setClipboard({ readText: () => Promise.reject(new DOMException('Refusé', 'NotAllowedError')) });
    const dialog = await openPaste(user);
    await user.click(within(dialog).getByRole('button', { name: 'Coller depuis le presse-papiers' }));
    expect(await within(dialog).findByText('Touche la zone de texte puis « Coller » pour y placer le JSON.')).toBeInTheDocument();
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText('JSON du programme')).toHaveFocus();
  });

  it('presse-papiers absent (HTTP local) : pas de bouton, collage manuel possible', async () => {
    const user = renderAt('#/');
    setClipboard(undefined);
    const dialog = await openPaste(user);
    expect(within(dialog).queryByRole('button', { name: 'Coller depuis le presse-papiers' })).not.toBeInTheDocument();
    expect(within(dialog).getByText('Touche la zone de texte puis « Coller » pour y placer le JSON.')).toBeInTheDocument();
    await pasteText(user, dialog, program);
    await user.click(within(dialog).getByRole('button', { name: 'Vérifier' }));
    expect(await screen.findByRole('dialog', { name: 'Importer ce programme ?' })).toBeInTheDocument();
  });

  it('Annuler dans la zone de collage : rien d’écrit', async () => {
    const user = renderAt('#/');
    const dialog = await openPaste(user);
    await pasteText(user, dialog, program);
    await user.click(within(dialog).getByRole('button', { name: 'Annuler' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(await dumpDatabase()).toEqual(EMPTY_DB);
  });
});
