import { describe, expect, it } from 'vitest';
import {
  cancelResend,
  completeTask,
  dropTask,
  EMPTY_OUTBOX,
  ENQUEUE_DELAY_MS,
  enqueueTask,
  failTask,
  ignoreTask,
  nextDueTask,
  nextWakeUp,
  outboxSummary,
  pauseForRegression,
  resendProgress,
  resolveRegression,
  RETRY_DELAYS_MS,
  retryTask,
  startResend,
  type DriveOutboxState,
} from './driveOutbox';

const T0 = Date.parse('2026-10-04T10:00:00Z');
const err = { code: 'network', message: 'Réseau indisponible', detail: '' };

describe('File d’attente (domaine)', () => {
  it('intentions dédupliquées par (type, clé) : la plus récente remplace, révision incrémentée', () => {
    let s = enqueueTask(EMPTY_OUTBOX, 'session', 'w-1', T0);
    s = enqueueTask(s, 'session', 'w-1', T0 + 5_000);
    s = enqueueTask(s, 'session_deleted', 'w-1', T0 + 6_000);
    expect(s.tasks.map((t) => [t.id, t.revision])).toEqual([
      ['session:w-1', 2],
      ['session_deleted:w-1', 1],
    ]);
    // « En attente depuis » garde la première mise en file ; premier essai 2 s après la dernière.
    expect(s.tasks[0]?.createdAt).toBe(new Date(T0).toISOString());
    expect(s.tasks[0]?.nextAttemptAt).toBe(new Date(T0 + 5_000 + ENQUEUE_DELAY_MS).toISOString());
  });

  it('ordre : séances avant suppressions, puis ancienneté ; modes « timer » et « all »', () => {
    let s = enqueueTask(EMPTY_OUTBOX, 'session_deleted', 'w-9', T0);
    s = enqueueTask(s, 'session', 'w-2', T0 + 1_000);
    s = enqueueTask(s, 'session', 'w-1', T0 + 2_000);
    expect(nextDueTask(s, T0, 'timer')).toBeNull();
    expect(nextDueTask(s, T0, 'all')?.id).toBe('session:w-2');
    expect(nextDueTask(s, T0 + 10_000, 'timer')?.id).toBe('session:w-2');
    expect(nextWakeUp(s)).toBe(T0 + ENQUEUE_DELAY_MS);
  });

  it('reprises : 30 s, 2 min, 10 min, 1 h, puis à la prochaine ouverture', () => {
    let s: DriveOutboxState = enqueueTask(EMPTY_OUTBOX, 'session', 'w-1', T0);
    const delays: (number | null)[] = [];
    for (let i = 0; i < 5; i++) {
      const task = s.tasks[0];
      if (!task) throw new Error();
      s = failTask(s, task, err, true, T0);
      const next = s.tasks[0]?.nextAttemptAt ?? null;
      delays.push(next === null ? null : Date.parse(next) - T0);
    }
    expect(delays).toEqual([...RETRY_DELAYS_MS, null]);
    expect(s.tasks[0]).toMatchObject({ status: 'pending', attempts: 5 });
    // Plus de minuteur, mais l'ouverture de l'app (mode « all ») la reprend.
    expect(nextWakeUp(s)).toBeNull();
    expect(nextDueTask(s, T0 + 10 * 3_600_000, 'timer')).toBeNull();
    expect(nextDueTask(s, T0, 'all')?.id).toBe('session:w-1');
  });

  it('non réessayable : « en erreur », hors file automatique ; Réessayer / Ignorer', () => {
    let s = enqueueTask(EMPTY_OUTBOX, 'session', 'w-1', T0);
    const first = s.tasks[0];
    if (!first) throw new Error();
    s = failTask(s, first, { code: 'unauthorized', message: 'Secret refusé', detail: '' }, false, T0);
    expect(s.tasks[0]).toMatchObject({ status: 'error', nextAttemptAt: null });
    expect(nextDueTask(s, T0, 'all')).toBeNull();
    expect(outboxSummary(s, T0)).toMatchObject({ pending: 0, errors: 1 });
    const retried = retryTask(s, 'session:w-1', T0 + 1);
    expect(retried.tasks[0]).toMatchObject({ status: 'pending', attempts: 0 });
    expect(ignoreTask(s, 'session:w-1').tasks).toEqual([]);
  });

  it('une confirmation tardive n’efface jamais une intention plus récente', () => {
    let s = enqueueTask(EMPTY_OUTBOX, 'session', 'w-1', T0);
    const sent = s.tasks[0];
    if (!sent) throw new Error();
    s = enqueueTask(s, 'session', 'w-1', T0 + 1_000); // correction pendant l'envoi
    s = completeTask(s, sent, T0 + 2_000);
    expect(s.tasks.map((t) => t.revision)).toEqual([2]);
    expect(s.lastConfirmedAt).toBe(new Date(T0 + 2_000).toISOString());
    expect(dropTask(s, sent).tasks).toHaveLength(1);
    expect(failTask(s, sent, err, true, T0).tasks[0]?.attempts).toBe(0);
  });

  it('résumé : en attente depuis plus d’une heure (puce de l’accueil)', () => {
    let s = enqueueTask(EMPTY_OUTBOX, 'session', 'w-1', T0);
    s = enqueueTask(s, 'session', 'w-2', T0 + 3_000_000);
    expect(outboxSummary(s, T0 + 3_600_001)).toMatchObject({ pending: 2, stalled: 1 });
  });
});

describe('Garde-fous et renvoi (V1.3b)', () => {
  it('une confirmation conserve le reste de l’état (régression, base vide, renvoi en cours)', () => {
    let s: DriveOutboxState = startResend(EMPTY_OUTBOX, [{ type: 'session', key: 'w-1' }, { type: 'backup_latest', key: 'latest' }], T0);
    s = { ...s, emptySkipAt: new Date(T0).toISOString(), regression: { current: { sessions: 2, weights: 1 }, incoming: { sessions: 1, weights: 1 }, at: 'x' } };
    const first = s.tasks[0];
    if (!first) throw new Error();
    const next = completeTask(s, first, T0 + 1);
    expect(next.resend).toEqual(s.resend);
    expect(next.regression).toEqual(s.regression);
    expect(next.emptySkipAt).toBe(s.emptySkipAt);
    expect(resendProgress(next)).toEqual({ done: 1, total: 2 });
  });

  it('sauvegarde en pause : une nouvelle intention reste en pause ; « Remplacer » la relance avec force', () => {
    let s = enqueueTask(EMPTY_OUTBOX, 'backup_latest', 'latest', T0);
    const task = s.tasks[0];
    if (!task) throw new Error();
    s = pauseForRegression(s, task, { current: { sessions: 5, weights: 2 }, incoming: { sessions: 4, weights: 2 }, at: 'x' }, err, T0);
    s = enqueueTask(s, 'backup_latest', 'latest', T0 + 1);
    expect(s.tasks[0]).toMatchObject({ status: 'paused', revision: 2, nextAttemptAt: null });
    expect(nextDueTask(s, T0 + 10_000, 'all')).toBeNull();
    expect(outboxSummary(s, T0 + 10 * 3_600_000)).toMatchObject({ paused: 1, pending: 0, stalled: 0 });
    const replaced = resolveRegression(s, 'replace', T0 + 2);
    expect(replaced.tasks[0]).toMatchObject({ status: 'pending', force: true });
    expect(replaced.regression).toBeNull();
    expect(resolveRegression(s, 'ignore', T0 + 2).tasks).toEqual([]);
  });

  it('ordre : sauvegardes en dernier ; annulation du renvoi garde une intention renouvelée', () => {
    let s = enqueueTask(EMPTY_OUTBOX, 'backup_weekly', 'weekly', T0);
    s = enqueueTask(s, 'backup_latest', 'latest', T0);
    s = enqueueTask(s, 'weights_all', 'all', T0);
    s = enqueueTask(s, 'weight', '2026-10-01', T0);
    s = enqueueTask(s, 'session', 'w-1', T0);
    const order: string[] = [];
    let state = s;
    for (let task = nextDueTask(state, T0, 'all'); task; task = nextDueTask(state, T0, 'all')) {
      order.push(task.type);
      state = completeTask(state, task, T0);
    }
    expect(order).toEqual(['session', 'weight', 'weights_all', 'backup_latest', 'backup_weekly']);
    let r = startResend(EMPTY_OUTBOX, [{ type: 'session', key: 'a' }, { type: 'session', key: 'b' }], T0);
    r = enqueueTask(r, 'session', 'b', T0 + 1); // vrai événement pendant le renvoi
    expect(cancelResend(r).tasks.map((t) => t.id)).toEqual(['session:b']);
  });
});
