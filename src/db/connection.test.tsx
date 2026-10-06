// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { Dexie } from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { ConnectionNotice } from '../app/ConnectionNotice';
import { getConnectionIssue, setConnectionIssue } from './connectionStatus';
import { DB_VERSION, TrainingDatabase } from './database';

const NAME = 'connection-test-db';

/** Ancien code (V1) recopié : stores de la version 1 seulement. */
class V1Database extends Dexie {
  constructor() {
    super(NAME);
    this.version(1).stores({ programs: '&programId', workouts: '&id, status, date, programId', settings: '&key', metadata: '&key' });
  }
}

const WORKOUT = { id: 'w-1', status: 'completed', date: '2026-10-01', programId: 'p' };

async function createV1WithData() {
  const v1 = new V1Database();
  await v1.open();
  await v1.table('workouts').put(WORKOUT);
  await v1.table('settings').put({ key: 'lastExportAt', value: '2026-10-01T10:00:00+02:00' });
  v1.close();
}

/**
 * Onglet resté sur l'ancienne version qui NE ferme PAS sa connexion (pas de gestionnaire
 * `versionchange`) : c'est ce qui bloque une montée de version dans IndexedDB.
 */
function openStubbornConnection(version?: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = version === undefined ? indexedDB.open(NAME) : indexedDB.open(NAME, version);
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(request.error ?? new Error('open'));
    };
  });
}

const nextTick = () => new Promise((r) => setTimeout(r, 20));

afterEach(async () => {
  cleanup();
  setConnectionIssue(null);
  await Dexie.delete(NAME);
});

describe('Ancienne version ouverte dans un autre onglet pendant la montée en v2', () => {
  it('blocked : message « ferme les autres onglets », puis reprise seule à la fermeture, sans perte', async () => {
    await createV1WithData();
    const oldTab = await openStubbornConnection(); // connexion v1 (IDB 10) jamais fermée d'elle-même
    render(<ConnectionNotice />);

    const v2 = new TrainingDatabase(NAME);
    let opened = false;
    const opening = v2.open().then(() => {
      opened = true;
    });
    await act(nextTick);
    expect(getConnectionIssue()).toBe('blocked');
    expect(opened).toBe(false);
    expect(screen.getByRole('alertdialog', { name: 'Ferme les autres onglets de l’app' })).toBeInTheDocument();
    expect(screen.getByText(/Ferme les autres onglets de l’app, puis rouvre-la/)).toBeInTheDocument();
    expect(screen.getByText('Tes données ne sont pas perdues.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument();

    // L'utilisateur ferme l'autre onglet : la mise à jour reprend d'elle-même.
    oldTab.close();
    await act(async () => {
      await opening;
    });
    expect(opened).toBe(true);
    expect(v2.verno).toBe(DB_VERSION); // V1.5.0 : la montée va jusqu'à la version courante
    expect(getConnectionIssue()).toBeNull();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(await v2.workouts.get('w-1')).toEqual(WORKOUT);
    expect(await v2.settings.get('lastExportAt')).toEqual({ key: 'lastExportAt', value: '2026-10-01T10:00:00+02:00' });
    expect(await v2.weights.count()).toBe(0);
    v2.close();
  });

  it('cas courant : l’ancien onglet utilise Dexie, qui ferme sa connexion → aucune attente, aucun message', async () => {
    await createV1WithData();
    const oldTab = new V1Database();
    await oldTab.open();
    const v2 = new TrainingDatabase(NAME);
    await v2.open();
    expect(v2.verno).toBe(DB_VERSION); // V1.5.0 : la montée va jusqu'à la version courante
    expect(getConnectionIssue()).toBeNull();
    expect(oldTab.isOpen()).toBe(false);
    expect(await v2.workouts.get('w-1')).toEqual(WORKOUT);
    v2.close();
  });
});

describe('Version plus récente ouverte ailleurs (versionchange reçu par cet onglet)', () => {
  it('message « recharge cette page », connexion fermée pour laisser passer, données intactes', async () => {
    await createV1WithData();
    const thisTab = new TrainingDatabase(NAME);
    await thisTab.open();
    await thisTab.weights.put({ date: '2026-10-02', weightKg: 80.4, recordedAt: '2026-10-02T07:00:00+02:00' });
    render(<ConnectionNotice />);

    // Un futur code ouvre la même base dans un autre onglet. V1.5.0 (adaptation signalée) : la
    // version courante est désormais 3 (IDB 30) ; le « futur » est donc la version suivante.
    const FUTURE_IDB_VERSION = (DB_VERSION + 1) * 10;
    const newer = await openStubbornConnection(FUTURE_IDB_VERSION);
    await act(nextTick);
    expect(getConnectionIssue()).toBe('superseded');
    expect(screen.getByRole('alertdialog', { name: 'Nouvelle version ouverte ailleurs' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Recharger la page' })).toBeInTheDocument();
    expect(thisTab.isOpen()).toBe(false);

    // Rien n'a été perdu pendant la montée de version.
    expect(newer.version).toBe(FUTURE_IDB_VERSION);
    const count = await new Promise<number>((resolve) => {
      const request = newer.transaction('weights').objectStore('weights').count();
      request.onsuccess = () => {
        resolve(request.result);
      };
    });
    expect(count).toBe(1);
    newer.close();
  });

  it('suppression de base (outils de développement) : aucun message', async () => {
    const thisTab = new TrainingDatabase(NAME);
    await thisTab.open();
    await Dexie.delete(NAME);
    expect(getConnectionIssue()).toBeNull();
  });
});
