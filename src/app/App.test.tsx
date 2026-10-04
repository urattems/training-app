// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getActiveProgramId } from '../services/settingsService';
import { dumpDatabase, fixtureObject, readFixture, resetDatabase } from '../test/fixtures';
import { App } from './App';

/** Objet imbriqué d'un JSON de test (ex. sessions[0].exercises[1]). */
const objectAt = (root: unknown, ...path: (string | number)[]): Record<string, unknown> =>
  path.reduce<unknown>((node, key) => (node as Record<string | number, unknown>)[key], root) as Record<string, unknown>;

const jsonFile =(content: string, name = 'programme.json') => new File([content], name, { type: 'application/json' });

function renderAt(hash: string) {
  window.location.hash = hash;
  const user = userEvent.setup();
  render(<App />);
  return user;
}

async function uploadProgram(user: ReturnType<typeof userEvent.setup>, content: string) {
  await user.upload(screen.getByLabelText('Choisir un fichier programme (.json)'), jsonFile(content));
}

beforeEach(resetDatabase);
afterEach(cleanup);

describe('Premier lancement', () => {
  it('affiche « Bienvenue », le bouton d\'import et la navigation à 4 onglets', async () => {
    renderAt('#/');
    expect(await screen.findByRole('heading', { name: 'Bienvenue' })).toBeInTheDocument();
    expect(screen.getByText('Importe ton premier programme pour commencer.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Importer un programme JSON' })).toBeInTheDocument();

    const nav = screen.getByRole('navigation', { name: 'Navigation principale' });
    expect(within(nav).getAllByRole('link').map((l) => l.textContent)).toEqual(['Accueil', 'Programme', 'Progression', 'Poids']);
    expect(within(nav).getByRole('link', { name: 'Accueil' })).toHaveAttribute('aria-current', 'page');
    // Les Paramètres sont une roue crantée, jamais un 4e onglet.
    expect(screen.getByRole('link', { name: 'Paramètres' })).toBeInTheDocument();
  });

  it('aucune donnée de démo : Programme et Progression affichent leur état vide', async () => {
    const user = renderAt('#/');
    await user.click(await screen.findByRole('link', { name: 'Programme' }));
    expect(await screen.findByRole('heading', { name: 'Aucun programme' })).toBeInTheDocument();
    expect(window.location.hash).toBe('#/program');
    await user.click(screen.getByRole('link', { name: 'Progression' }));
    expect(await screen.findByRole('heading', { name: 'Pas encore de progression' })).toBeInTheDocument();
    expect(window.location.hash).toBe('#/progress');
  });
});

describe('Import d\'un programme valide', () => {
  it('prévisualise, importe examples/program-example.json et l\'affiche', async () => {
    const user = renderAt('#/');
    await screen.findByRole('heading', { name: 'Bienvenue' });
    await uploadProgram(user, readFixture('program-example.json'));

    const preview = await screen.findByRole('dialog', { name: 'Importer ce programme ?' });
    expect(within(preview).getByText('Programme semaine 40')).toBeInTheDocument();
    expect(within(preview).getByText('Semaine 40')).toBeInTheDocument();
    expect(within(preview).getByText('3')).toBeInTheDocument();
    expect(within(preview).getByText('9')).toBeInTheDocument();
    expect(within(preview).queryByText(/Champs ignorés/)).not.toBeInTheDocument();
    // Rien n'est écrit avant la confirmation.
    expect(await getActiveProgramId()).toBeNull();

    await user.click(within(preview).getByRole('button', { name: 'Importer' }));
    const success = await screen.findByRole('dialog', { name: 'Programme importé' });
    expect(within(success).getByText('« Programme semaine 40 » est maintenant ton programme actif.')).toBeInTheDocument();
    expect(await getActiveProgramId()).toBe('prog-2026-w40');

    await user.click(within(success).getByRole('button', { name: 'Continuer' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    // J3a : l'accueil présente la prochaine séance du programme importé (SPEC §7.2).
    expect(await screen.findByRole('heading', { name: 'Séance A' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Commencer la séance' })).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: 'Programme' }));
    expect(await screen.findByText('Programme semaine 40')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Séance A' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Séance C' })).toBeInTheDocument();
    expect(screen.getByText('Élévations latérales')).toBeInTheDocument();
  });

  it('signale discrètement les champs inconnus ignorés', async () => {
    const program = fixtureObject('program-example.json');
    program.color = '#ff0000';
    Object.assign(objectAt(program, 'sessions', 0), { coachComment: 'Bonne semaine' });
    const user = renderAt('#/');
    await screen.findByRole('heading', { name: 'Bienvenue' });
    await uploadProgram(user, JSON.stringify(program));
    const preview = await screen.findByRole('dialog', { name: 'Importer ce programme ?' });
    expect(within(preview).getByText('Champs ignorés : coachComment, color')).toBeInTheDocument();
  });

  it('Annuler ne modifie rien', async () => {
    const user = renderAt('#/');
    await screen.findByRole('heading', { name: 'Bienvenue' });
    await uploadProgram(user, readFixture('program-example.json'));
    const preview = await screen.findByRole('dialog', { name: 'Importer ce programme ?' });
    await user.click(within(preview).getByRole('button', { name: 'Annuler' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(await dumpDatabase()).toEqual({ programs: [], workouts: [], settings: [], metadata: [] });
  });

  it('depuis les Paramètres, un second programme annonce l\'archivage de l\'actuel', async () => {
    const user = renderAt('#/settings');
    await uploadProgram(user, readFixture('program-example.json'));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Importer' }));
    await user.click(within(await screen.findByRole('dialog', { name: 'Programme importé' })).getByRole('button', { name: 'Continuer' }));
    expect(window.location.hash).toBe('#/');

    const next = fixtureObject('program-example.json');
    next.programId = 'prog-2026-w41';
    await user.click(screen.getByRole('link', { name: 'Paramètres' }));
    await uploadProgram(user, JSON.stringify(next));
    const preview = await screen.findByRole('dialog', { name: 'Importer ce programme ?' });
    expect(within(preview).getByText(/Le programme actuel « Programme semaine 40 » sera archivé/)).toBeInTheDocument();
  });
});

describe('Import invalide refusé proprement', () => {
  it('exercice sans identifiant : message français de la SPEC, rien n\'est écrit', async () => {
    const program = fixtureObject('program-example.json');
    delete objectAt(program, 'sessions', 0, 'exercises', 1).id;

    const user = renderAt('#/');
    await screen.findByRole('heading', { name: 'Bienvenue' });
    await uploadProgram(user, JSON.stringify(program));

    const dialog = await screen.findByRole('dialog', { name: 'Fichier refusé' });
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Import impossible : la séance A contient un exercice sans identifiant.');
    expect(within(dialog).queryByRole('list')).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Afficher les détails' }));
    expect(within(dialog).getByRole('list')).toHaveTextContent('sessions.0.exercises.1.id');

    await user.click(within(dialog).getByRole('button', { name: 'Fermer' }));
    expect(await dumpDatabase()).toEqual({ programs: [], workouts: [], settings: [], metadata: [] });
    expect(screen.getByRole('heading', { name: 'Bienvenue' })).toBeInTheDocument();
  });

  it('fichier qui n\'est pas du JSON', async () => {
    const user = renderAt('#/');
    await screen.findByRole('heading', { name: 'Bienvenue' });
    await uploadProgram(user, 'ceci n’est pas du JSON');
    const dialog = await screen.findByRole('dialog', { name: 'Fichier refusé' });
    expect(within(dialog).getByRole('alert')).toHaveTextContent("Import impossible : le fichier n'est pas un JSON valide.");
    expect(await getActiveProgramId()).toBeNull();
  });

  it('sauvegarde choisie à la place d\'un programme', async () => {
    const user = renderAt('#/');
    await screen.findByRole('heading', { name: 'Bienvenue' });
    await uploadProgram(user, readFixture('history-example.json'));
    const dialog = await screen.findByRole('dialog', { name: 'Fichier refusé' });
    expect(within(dialog).getByRole('alert')).toHaveTextContent("ce fichier n'est pas un programme");
    expect(await dumpDatabase()).toEqual({ programs: [], workouts: [], settings: [], metadata: [] });
  });
});

describe('Navigation', () => {
  it('la barre basse est masquée sur l\'écran exercice', async () => {
    renderAt('#/workout/w-1/exercise/chest-press-machine');
    expect(await screen.findByRole('heading', { name: 'Page introuvable', level: 1 })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Navigation principale' })).not.toBeInTheDocument();
  });

  it('route inconnue : page introuvable avec retour à l\'accueil', async () => {
    const user = renderAt('#/nulle-part');
    await user.click(await screen.findByRole('link', { name: 'Retour à l’accueil' }));
    expect(await screen.findByRole('heading', { name: 'Bienvenue' })).toBeInTheDocument();
  });
});
