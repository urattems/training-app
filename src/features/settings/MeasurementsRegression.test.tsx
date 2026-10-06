// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDriveClient, type FetchLike } from '../../services/driveClient';
import { getOutbox, processDriveOutbox, setDriveClient } from '../../services/driveOutbox';
import { markDriveTested, saveDriveConfig, setDriveEnabled } from '../../services/driveSettings';
import { addMeasurement } from '../../services/measurementService';
import { setLastWeeklyBackupAt } from '../../services/settingsService';
import { resetDatabase } from '../../test/fixtures';
import { DriveRegressionNotice } from './DriveRegressionNotice';

const URL_ = 'https://script.google.com/macros/s/AKfycbMESURES/exec';
const SECRET = 'secret-mesures-regression-9';
const FULL = { chestCm: 104.5, bellyCm: 92, waistCm: 88.3, bicepsCm: 36.1, thighCm: 58.2, calfCm: 38.4 };

/** Réponse d'un futur script qui compterait aussi les mensurations. */
let regressionBody: Record<string, unknown> = {};
const fetch: FetchLike = () => Promise.resolve(new Response(JSON.stringify({ ok: false, error: 'regression', ...regressionBody })));

beforeEach(async () => {
  await resetDatabase();
  setDriveClient(createDriveClient({ fetch }));
  await saveDriveConfig(URL_, SECRET);
  await markDriveTested('2026-10-04T10:00:00+02:00', { url: URL_, secret: SECRET });
  await setDriveEnabled(true);
  await setLastWeeklyBackupAt(new Date().toISOString());
});
afterEach(cleanup);

async function regressionNotice() {
  await addMeasurement('2026-10-01', FULL, new Date(2026, 9, 6, 10));
  await processDriveOutbox('all');
  const { regression } = await getOutbox();
  if (!regression) throw new Error('pas de régression');
  render(
    <MemoryRouter>
      <DriveRegressionNotice regression={regression} />
    </MemoryRouter>,
  );
  return regression;
}

describe('Message de régression et mensurations (lecture tolérante)', () => {
  it('le script renvoie les mensurations : elles sont citées', async () => {
    regressionBody = { current: { sessions: 3, weights: 10, measurements: 4 }, incoming: { sessions: 0, weights: 0, measurements: 1 } };
    const regression = await regressionNotice();
    expect(regression.current).toEqual({ sessions: 3, weights: 10, measurements: 4 });
    expect(
      screen.getByText('Ton Drive contient une sauvegarde plus complète (3 séances, 10 pesées, 4 mensurations) que cette app (0, 0, 1). Rien n’a été écrasé.'),
    ).toBeInTheDocument();
  });

  it('le script (sync-2) ne les renvoie pas : message d’origine, inchangé', async () => {
    regressionBody = { current: { sessions: 3, weights: 10 }, incoming: { sessions: 0, weights: 0 } };
    await regressionNotice();
    expect(screen.getByText('Ton Drive contient une sauvegarde plus complète (3 séances, 10 pesées) que cette app (0, 0). Rien n’a été écrasé.')).toBeInTheDocument();
  });

  it('compteur illisible (texte, null) : ignoré, jamais NaN à l’écran', async () => {
    regressionBody = { current: { sessions: 3, weights: 10, measurements: 'beaucoup' }, incoming: { sessions: 0, weights: 0, measurements: null } };
    const regression = await regressionNotice();
    expect(regression.current).toEqual({ sessions: 3, weights: 10 });
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
  });
});
