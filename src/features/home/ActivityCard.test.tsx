// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from '../../app/App';
import { db } from '../../db/database';
import type { TrainingProgram, WorkoutSession, WorkoutStatus } from '../../domain/types';
import { createWorkout } from '../../domain/workout';
import { importProgram, previewProgram } from '../../services/programService';
import { readFixture, resetDatabase } from '../../test/fixtures';
import { toLocalDateString } from '../../utils/dates';
import { formatDayLong } from '../../utils/format';
import { ActivityCard } from './ActivityCard';

const program = JSON.parse(readFileSync(resolve(process.cwd(), 'examples', 'program-example.json'), 'utf8')) as TrainingProgram;

function session(id: string, now: Date, status: WorkoutStatus = 'completed', name = 'Séance A'): WorkoutSession {
  const w = createWorkout(program, 'A', { id, now });
  return { ...w, sessionName: name, status, completedAt: status === 'completed' ? w.startedAt : null, durationSec: status === 'completed' ? 3900 : null };
}

const TODAY = '2026-10-06'; // mardi
const sessions = [
  session('w-1', new Date(2026, 9, 6, 7, 30), 'completed', 'Séance A'),
  session('w-2', new Date(2026, 9, 6, 18, 0), 'completed', 'Séance B'),
  session('w-3', new Date(2026, 9, 1, 18, 0), 'completed'),
  session('w-4', new Date(2026, 9, 2, 18, 0), 'abandoned'),
];

function renderCard(workouts: WorkoutSession[] = sessions) {
  const user = userEvent.setup();
  render(
    <MemoryRouter>
      <ActivityCard workouts={workouts} today={TODAY} />
    </MemoryRouter>,
  );
  return user;
}

const grid = () => screen.getByRole('group', { name: /^Activité des 12 dernières semaines/ });
const dayButton = (date: string) => within(grid()).getByRole('button', { name: new RegExp(`^${formatDayLong(date)}( \\(aujourd’hui\\))? :`) });

afterEach(cleanup);

describe('Carte Activité : grille et étiquettes accessibles', () => {
  it('84 boutons (12 semaines × 7 jours) dans un groupe nommé ; résumé neutre en séances', () => {
    renderCard();
    expect(within(grid()).getAllByRole('button')).toHaveLength(84);
    expect(screen.getByText('3 séances terminées sur les 12 dernières semaines')).toBeInTheDocument();
    // Pas de série de jours, pas de score.
    expect(document.body.textContent).not.toMatch(/série|d’affilée|consécutif|streak|score/i);
  });

  it('étiquettes : « mardi 6 octobre (aujourd’hui) : 2 séances », jour vide, abandonnée ignorée, à venir', () => {
    renderCard();
    expect(dayButton('2026-10-06')).toHaveAccessibleName(`${formatDayLong('2026-10-06')} (aujourd’hui) : 2 séances`);
    expect(dayButton('2026-10-06')).toHaveAttribute('aria-current', 'date');
    expect(dayButton('2026-10-01')).toHaveAccessibleName(`${formatDayLong('2026-10-01')} : 1 séance`);
    expect(dayButton('2026-10-02')).toHaveAccessibleName(`${formatDayLong('2026-10-02')} : aucune séance`);
    expect(dayButton('2026-10-07')).toHaveAccessibleName(`${formatDayLong('2026-10-07')} : à venir`);
    expect(within(grid()).getAllByRole('button', { current: 'date' })).toHaveLength(1);
  });
});

describe('Carte Activité : toucher une case', () => {
  it('le détail s’affiche SOUS la grille : date en toutes lettres, séances (nom, durée) menant au détail', async () => {
    const user = renderCard();
    await user.click(dayButton('2026-10-06'));
    const detail = screen.getByRole('region', { name: `Séances du ${formatDayLong('2026-10-06')}` });
    expect(grid().compareDocumentPosition(detail) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(detail).getByText(formatDayLong('2026-10-06'))).toBeInTheDocument();
    const links = within(detail).getAllByRole('link');
    expect(links.map((l) => l.textContent)).toEqual(['Séance A1 h 05', 'Séance B1 h 05']);
    expect(links.map((l) => l.getAttribute('href'))).toEqual(['/history/w-1', '/history/w-2']);
  });

  it('jour sans séance : « Pas de séance ce jour-là » (y compris une abandonnée) ; jour à venir : « Jour à venir »', async () => {
    const user = renderCard();
    await user.click(dayButton('2026-10-02'));
    expect(screen.getByText('Pas de séance ce jour-là')).toBeInTheDocument();
    await user.click(dayButton('2026-10-08'));
    expect(screen.getByText('Jour à venir')).toBeInTheDocument();
  });

  it('une seule case sélectionnée à la fois (aria-pressed) ; retoucher la désélectionne', async () => {
    const user = renderCard();
    await user.click(dayButton('2026-10-01'));
    await user.click(dayButton('2026-10-06'));
    expect(within(grid()).getAllByRole('button', { pressed: true })).toEqual([dayButton('2026-10-06')]);
    await user.click(dayButton('2026-10-06'));
    expect(within(grid()).queryAllByRole('button', { pressed: true })).toEqual([]);
    expect(screen.queryByRole('region', { name: /^Séances du/ })).not.toBeInTheDocument();
  });

  it('aucune séance sur la période : grille vide et phrase sobre', () => {
    renderCard([session('old', new Date(2026, 0, 5, 18, 0))]);
    expect(screen.getByText('Aucune séance terminée sur les 12 dernières semaines')).toBeInTheDocument();
    expect(within(grid()).getAllByRole('button').filter((b) => /: \d+ séance/.test(b.getAttribute('aria-label') ?? ''))).toEqual([]);
  });
});

describe('Accueil : placement et mise à jour', () => {
  beforeEach(async () => {
    await resetDatabase();
    const preview = previewProgram(readFixture('program-example.json'));
    if (!preview.ok) throw new Error(preview.error.message);
    const result = await importProgram(preview.value.program);
    if (!result.ok) throw new Error(result.error.message);
  });

  const renderHome = () => {
    window.location.hash = '#/';
    render(<App />);
  };

  it('sans séance terminée : pas de carte Activité (rien d’alarmant)', async () => {
    await db.workouts.put(session('ab', new Date(), 'abandoned'));
    renderHome();
    await screen.findByRole('button', { name: 'Commencer la séance' });
    expect(screen.queryByText('Activité')).not.toBeInTheDocument();
  });

  it('carte secondaire APRÈS le bouton principal ; apparaît dès qu’une séance est terminée', async () => {
    renderHome();
    const start = await screen.findByRole('button', { name: 'Commencer la séance' });
    expect(screen.queryByText('Activité')).not.toBeInTheDocument();
    const now = new Date();
    await db.workouts.put(session('w-today', now));
    const heading = await screen.findByText('Activité');
    expect(start.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const today = toLocalDateString(now);
    await waitFor(() => {
      expect(dayButton(today)).toHaveAccessibleName(`${formatDayLong(today)} (aujourd’hui) : 1 séance`);
    });
    // Suppression : mise à jour automatique (la carte disparaît, plus aucune séance terminée).
    await db.workouts.delete('w-today');
    await waitFor(() => {
      expect(screen.queryByText('Activité')).not.toBeInTheDocument();
    });
  });
});
