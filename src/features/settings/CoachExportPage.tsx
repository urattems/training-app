import { useMemo, useState } from 'react';
import { ClipboardCopy, Send, Share2 } from 'lucide-react';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Card, Eyebrow } from '../../components/Card';
import { EmptyState } from '../../components/EmptyState';
import { ErrorDetails } from '../../components/ErrorDetails';
import { LoadingState } from '../../components/LoadingState';
import { Page } from '../../components/Page';
import { listCoachExportable, selectLatest, selectSinceLastExport, summarizeSelection } from '../../domain/coachExport';
import { workoutStatusLabel } from '../../domain/display';
import type { WorkoutSession } from '../../domain/types';
import { useLastCoachExportAt, useWorkouts } from '../../hooks/useData';
import { usePreparedCoachExport } from '../../hooks/usePreparedCoachExport';
import { strings } from '../../i18n/strings';
import type { CoachSelectionMode } from '../../schemas/coachExport.schema';
import {
  copyCoachExport,
  deliverPreparedCoachExport,
  downloadPreparedCoachExport,
  type CoachSelectionRequest,
  type PreparedCoachExport,
} from '../../services/coachExportService';
import { toDisplayError, type DisplayError } from '../../utils/errors';
import { formatDateTime, formatDayLong, formatDayShort, formatDuration } from '../../utils/format';
import { STATUS_TONES } from '../history/HistoryPage';
import styles from './CoachExportPage.module.css';

const t = strings.coachExport;

type Shortcut = 'last1' | 'last3' | 'last6' | 'lastN' | 'since';

interface Selection {
  mode: CoachSelectionMode;
  ids: readonly string[];
  shortcut: Shortcut | null;
}

const LATEST: { shortcut: Shortcut; n: number; label: string }[] = [
  { shortcut: 'last1', n: 1, label: t.last1 },
  { shortcut: 'last3', n: 3, label: t.last3 },
  { shortcut: 'last6', n: 6, label: t.last6 },
];

/** « Exporter pour le coach » (SPEC §10.6) : sélection de séances, fichier ou copie pour ChatGPT. */
export function CoachExportPage() {
  const workouts = useWorkouts();
  const lastCoachExportAt = useLastCoachExportAt();
  const exportable = useMemo(() => (workouts ? listCoachExportable(workouts) : undefined), [workouts]);
  const loading = exportable === undefined || lastCoachExportAt === undefined;

  return (
    <Page title={t.title} backTo="/settings" backLabel={strings.settings.title}>
      {loading && <LoadingState />}
      {!loading && <CoachExportEditor exportable={exportable} lastCoachExportAt={lastCoachExportAt} />}
    </Page>
  );
}

function CoachExportEditor({ exportable, lastCoachExportAt }: { exportable: WorkoutSession[]; lastCoachExportAt: string | null }) {
  // Par défaut : ce qui n'a pas encore été envoyé (tout, s'il n'y a jamais eu d'envoi).
  const [selection, setSelection] = useState<Selection>(() => ({
    mode: 'since_last_export',
    ids: selectSinceLastExport(exportable, lastCoachExportAt),
    shortcut: 'since',
  }));
  const [nDraft, setNDraft] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [copyFailed, setCopyFailed] = useState(false);
  const [error, setError] = useState<DisplayError | null>(null);

  const selected = useMemo(() => new Set(selection.ids), [selection]);
  const request = useMemo<CoachSelectionRequest | null>(
    () => (selection.ids.length > 0 ? { mode: selection.mode, selectedIds: selection.ids } : null),
    [selection],
  );
  const prepared = usePreparedCoachExport(request);
  const ready = prepared.status === 'ready' ? prepared.prepared : null;
  const summary = summarizeSelection(exportable, selected);
  const empty = exportable.length === 0;

  const choose = (next: Selection) => {
    setSelection(next);
    setStatus(null);
    setCopyFailed(false);
    setError(null);
  };
  const latest = (n: number, shortcut: Shortcut) => {
    choose({ mode: 'last_n', ids: selectLatest(exportable, n), shortcut });
  };
  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    choose({ mode: 'manual', ids: exportable.filter((w) => next.has(w.id)).map((w) => w.id), shortcut: null });
  };

  const run = async (action: (p: PreparedCoachExport) => Promise<void>) => {
    if (!ready) return;
    setStatus(null);
    setError(null);
    try {
      await action(ready);
    } catch (e) {
      console.error(e);
      setError(toDisplayError(e, t.deliveryError));
    }
  };
  // Partage ou copie appelés sans attente préalable : le fichier est déjà prêt (geste iOS).
  const send = () =>
    run(async (p) => {
      const outcome = await deliverPreparedCoachExport(p);
      if (outcome === 'shared') setStatus(t.shared);
      else if (outcome === 'downloaded') setStatus(t.downloaded(p.file.name));
    });
  const copy = () =>
    run(async (p) => {
      const outcome = await copyCoachExport(p);
      setCopyFailed(outcome === 'unavailable');
      if (outcome === 'copied') setStatus(t.copied);
    });
  const downloadInstead = () =>
    run(async (p) => {
      await downloadPreparedCoachExport(p);
      setCopyFailed(false);
      setStatus(t.downloaded(p.file.name));
    });

  const sinceNote =
    selection.shortcut !== 'since'
      ? null
      : lastCoachExportAt === null
        ? t.sinceNever
        : selection.ids.length === 0
          ? t.sinceNothing
          : t.sinceDate(formatDateTime(lastCoachExportAt));

  return (
    <>
      <p className={styles.hint}>
        {lastCoachExportAt === null ? t.neverSent : t.lastSent(formatDateTime(lastCoachExportAt))}
      </p>

      {empty && <EmptyState icon={<Send />} title={t.emptyTitle} text={t.emptyText} />}

      <section className={styles.section} aria-labelledby="coach-shortcuts">
        <Eyebrow id="coach-shortcuts">{t.shortcuts}</Eyebrow>
        <div className={styles.shortcuts}>
          {LATEST.map(({ shortcut, n, label }) => (
            <Button
              key={shortcut}
              variant="secondary"
              disabled={empty}
              aria-pressed={selection.shortcut === shortcut}
              className={selection.shortcut === shortcut ? styles.active : undefined}
              onClick={() => {
                latest(n, shortcut);
              }}
            >
              {label}
            </Button>
          ))}
          <label className={`${styles.nField ?? ''} ${selection.shortcut === 'lastN' ? (styles.active ?? '') : ''}`}>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              enterKeyHint="done"
              autoComplete="off"
              aria-label={t.lastNLabel}
              placeholder="N"
              disabled={empty}
              value={nDraft}
              onChange={(e) => {
                const digits = e.target.value.replace(/\D/g, '').slice(0, 3);
                setNDraft(digits);
                const n = Number(digits);
                if (digits !== '' && n >= 1) latest(n, 'lastN');
              }}
            />
            <span>{t.lastN}</span>
          </label>
        </div>
        <Button
          variant="secondary"
          fullWidth
          disabled={empty}
          aria-pressed={selection.shortcut === 'since'}
          className={selection.shortcut === 'since' ? styles.active : undefined}
          onClick={() => {
            choose({ mode: 'since_last_export', ids: selectSinceLastExport(exportable, lastCoachExportAt), shortcut: 'since' });
          }}
        >
          {t.since}
        </Button>
        {sinceNote !== null && !empty && <p className={styles.hint}>{sinceNote}</p>}
      </section>

      <Card className={styles.actions}>
        <p className={styles.summary} aria-live="polite">
          <span>
            {summary.count === 0 || summary.firstDate === null || summary.lastDate === null
              ? t.summaryNone
              : t.summary(summary.count, t.range(formatDayShort(summary.firstDate), formatDayShort(summary.lastDate)))}
          </span>
          <span className={styles.outOf}>{t.outOf(exportable.length)}</span>
        </p>
        <Button
          size="lg"
          fullWidth
          icon={<Share2 aria-hidden />}
          disabled={!ready}
          loading={prepared.status === 'preparing'}
          onClick={() => void send()}
        >
          {prepared.status === 'preparing' ? t.preparing : t.send}
        </Button>
        <Button variant="secondary" fullWidth icon={<ClipboardCopy aria-hidden />} disabled={!ready} onClick={() => void copy()}>
          {t.copy}
        </Button>
        <p className={styles.help}>{t.help}</p>
        {status !== null && (
          <p role="status" className={styles.success}>
            {status}
          </p>
        )}
        {copyFailed && (
          <div className={styles.fallback}>
            <p role="status">{t.copyUnavailable}</p>
            <Button variant="secondary" fullWidth disabled={!ready} onClick={() => void downloadInstead()}>
              {t.downloadInstead}
            </Button>
          </div>
        )}
        {prepared.status === 'error' && <ErrorBox error={prepared.error} />}
        {error !== null && <ErrorBox error={error} />}
      </Card>

      {!empty && (
        <section className={styles.section} aria-labelledby="coach-sessions">
          <Eyebrow id="coach-sessions">{t.sessions}</Eyebrow>
          <Card className={styles.listCard}>
            <ul className={styles.list}>
              {exportable.map((workout) => (
                <li key={workout.id}>
                  <SessionRow
                    workout={workout}
                    checked={selected.has(workout.id)}
                    onToggle={() => {
                      toggle(workout.id);
                    }}
                  />
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}
    </>
  );
}

function SessionRow({ workout, checked, onToggle }: { workout: WorkoutSession; checked: boolean; onToggle: () => void }) {
  const date = formatDayLong(workout.date);
  return (
    <label className={styles.row}>
      <input type="checkbox" className={styles.checkbox} checked={checked} onChange={onToggle} aria-label={t.selectLabel(workout.sessionName, date)} />
      <span className={styles.text}>
        <span className={styles.name}>{workout.sessionName}</span>
        <span className={styles.meta}>
          {[date, workout.durationSec !== null ? formatDuration(workout.durationSec) : null].filter(Boolean).join(' · ')}
        </span>
      </span>
      <Badge tone={STATUS_TONES[workout.status]}>{workoutStatusLabel(workout.status)}</Badge>
    </label>
  );
}

function ErrorBox({ error }: { error: DisplayError }) {
  return (
    <div role="alert" className={styles.error}>
      <p>{error.message}</p>
      <ErrorDetails details={error.details} />
    </div>
  );
}
