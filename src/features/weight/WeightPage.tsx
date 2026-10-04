import { useCallback, useEffect, useId, useMemo, useRef, useState, type SyntheticEvent } from 'react';
import { Pencil, Plus, Scale, Trash2, X } from 'lucide-react';
import { useSearchParams } from 'react-router';
import { Button } from '../../components/Button';
import { Card, Eyebrow } from '../../components/Card';
import { ConfirmSheet } from '../../components/ConfirmSheet';
import { EmptyState } from '../../components/EmptyState';
import fieldStyles from '../../components/Field.module.css';
import { LoadingState } from '../../components/LoadingState';
import { IconButton, Page } from '../../components/Page';
import { Sheet } from '../../components/Sheet';
import type { ChartPoint } from '../../domain/chart';
import { formatSignedKg, PERIODS, type Period } from '../../domain/stats';
import type { WeightEntry } from '../../domain/types';
import {
  buildWeightSeries,
  parseWeightInput,
  previousWeight,
  validateWeightDate,
  weightDelta,
  weightSanity,
  weightStats,
  weightValueAxis,
  type WeightWarning,
} from '../../domain/weight';
import { useWeights } from '../../hooks/useData';
import { useToday } from '../../hooks/useToday';
import { strings } from '../../i18n/strings';
import { addWeight, deleteWeight, updateWeight } from '../../services/weightService';
import { daysBetween } from '../../utils/dates';
import { toDisplayError } from '../../utils/errors';
import { formatDayLong, formatDayShort } from '../../utils/format';
import { formatDecimal, formatKg } from '../../utils/numbers';
import { ProgressChart } from '../progress/ProgressChart';
import progressStyles from '../progress/ProgressPage.module.css';
import styles from './WeightPage.module.css';

const t = strings.weight;
const DEFAULT_PERIOD: Period = '3M';
const isPeriod = (value: string | null): value is Period => PERIODS.some((p) => p === value);

/** Demande d'écriture, avant les confirmations éventuelles. */
interface SaveRequest {
  mode: 'add' | 'edit';
  date: string;
  weightKg: number;
  /** Appelé après une écriture réussie (message de confirmation). */
  onSaved: (message: string) => void;
}

type Pending =
  | { kind: 'sanity'; request: SaveRequest; warnings: WeightWarning[]; previous: WeightEntry | null }
  | { kind: 'replace'; request: SaveRequest; existing: WeightEntry };

/**
 * Enchaînement commun aux trois saisies (jour, ajout daté, correction) :
 * avertissement doux « C'est bien ça ? » (jamais bloquant), puis confirmation explicite de
 * remplacement si la date a déjà une pesée. Jamais de remplacement silencieux.
 */
function useWeightSaver(entries: WeightEntry[]) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const write = async (request: SaveRequest, replace: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const label = formatDayLong(request.date);
      if (request.mode === 'edit') {
        await updateWeight(request.date, request.weightKg);
        request.onSaved(t.updated(formatKg(request.weightKg), label));
      } else {
        const result = await addWeight({ date: request.date, weightKg: request.weightKg, replace });
        // Garde-fou du service : une pesée apparue entre-temps n'est jamais écrasée sans confirmation.
        if (result.status === 'exists') {
          setPending({ kind: 'replace', request, existing: result.existing });
          return;
        }
        request.onSaved(t.saved(formatKg(request.weightKg), label));
      }
      setPending(null);
    } catch (e) {
      setError(toDisplayError(e, t.error).message);
      setPending(null);
    } finally {
      setBusy(false);
    }
  };

  const proceed = (request: SaveRequest, sanityChecked: boolean) => {
    if (!sanityChecked) {
      const previous = previousWeight(entries, request.date);
      const warnings = weightSanity(request.weightKg, previous);
      if (warnings.length > 0) {
        setPending({ kind: 'sanity', request, warnings, previous });
        return;
      }
    }
    const existing = request.mode === 'add' ? entries.find((e) => e.date === request.date) : undefined;
    if (existing) {
      setPending({ kind: 'replace', request, existing });
      return;
    }
    void write(request, false);
  };

  const confirmation = pending && (
    <SaverConfirmation
      pending={pending}
      busy={busy}
      onConfirm={() => {
        if (pending.kind === 'sanity') proceed(pending.request, true);
        else void write(pending.request, true);
      }}
      onCancel={() => {
        setPending(null);
      }}
    />
  );

  return {
    submit: (request: SaveRequest) => {
      setError(null);
      proceed(request, false);
    },
    confirmation,
    error,
    busy,
  };
}

function SaverConfirmation({ pending, busy, onConfirm, onCancel }: { pending: Pending; busy: boolean; onConfirm: () => void; onCancel: () => void }) {
  const today = useToday();
  const value = formatKg(pending.request.weightKg);
  if (pending.kind === 'replace') {
    return (
      <ConfirmSheet
        title={t.replaceTitle(formatKg(pending.existing.weightKg), value, pending.request.date === today)}
        confirmLabel={t.replaceConfirm}
        busy={busy}
        onConfirm={onConfirm}
        onCancel={onCancel}
      >
        <p>{t.replaceText(formatDayLong(pending.request.date))}</p>
      </ConfirmSheet>
    );
  }
  const { previous } = pending;
  const lines = pending.warnings.map((w) =>
    w === 'big_change' && previous
      ? t.sanityBigChange(value, formatSignedKg(Math.round((pending.request.weightKg - previous.weightKg) * 100) / 100), formatKg(previous.weightKg), formatDayShort(previous.date))
      : w === 'below_range'
        ? t.sanityBelow(value)
        : t.sanityAbove(value),
  );
  return (
    <ConfirmSheet title={t.sanityTitle} confirmLabel={t.sanityConfirm} cancelLabel={t.sanityCancel} busy={busy} onConfirm={onConfirm} onCancel={onCancel}>
      {lines.map((line) => (
        <p key={line}>{line}</p>
      ))}
    </ConfirmSheet>
  );
}

/** Onglet « Poids » (SPEC §7.11) : saisie du jour, graphique, statistiques, liste. Aucun objectif, aucun conseil. */
export default function WeightPage() {
  const entries = useWeights();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<WeightEntry | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <Page
      title={t.title}
      trailing={
        <IconButton
          label={t.add}
          onClick={() => {
            setAdding(true);
          }}
        >
          <Plus aria-hidden />
        </IconButton>
      }
    >
      {entries === undefined ? (
        <LoadingState />
      ) : (
        <WeightContent
          entries={entries}
          notice={notice}
          onNotice={setNotice}
          onEdit={setEditing}
          adding={adding}
          onCloseAdd={() => {
            setAdding(false);
          }}
          editing={editing}
          onCloseEdit={() => {
            setEditing(null);
          }}
        />
      )}
    </Page>
  );
}

interface WeightContentProps {
  entries: WeightEntry[];
  notice: string | null;
  onNotice: (message: string | null) => void;
  onEdit: (entry: WeightEntry) => void;
  adding: boolean;
  onCloseAdd: () => void;
  editing: WeightEntry | null;
  onCloseEdit: () => void;
}

function WeightContent({ entries, notice, onNotice, onEdit, adding, onCloseAdd, editing, onCloseEdit }: WeightContentProps) {
  const today = useToday();
  const saver = useWeightSaver(entries);
  const [searchParams, setSearchParams] = useSearchParams();
  const periodParam = searchParams.get('periode');
  const period: Period = isPeriod(periodParam) ? periodParam : DEFAULT_PERIOD;
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<WeightEntry | null>(null);

  const series = useMemo(() => buildWeightSeries(entries, period, today), [entries, period, today]);
  const stats = useMemo(() => weightStats(entries, period, today), [entries, period, today]);
  const latest = entries.at(-1) ?? null;
  const visibleSelected = series.points.some((p) => p.date === selectedDate) ? selectedDate : null;
  const selectedEntry = entries.find((e) => e.date === visibleSelected) ?? null;

  const onSelect = useCallback((point: ChartPoint) => {
    setSelectedDate((current) => (current === point.date ? null : point.date));
  }, []);
  const pointLabel = useCallback((point: ChartPoint) => t.pointLabel(formatDayLong(point.date), formatKg(point.value)), []);

  return (
    <>
      <TodayCard
        today={today}
        placeholder={latest ? formatDecimal(latest.weightKg) : ''}
        busy={saver.busy}
        onSubmit={(weightKg, reset) => {
          onNotice(null);
          saver.submit({
            mode: 'add',
            date: today,
            weightKg,
            onSaved: (message) => {
              reset();
              onNotice(message);
            },
          });
        }}
      />
      {notice !== null && (
        <p role="status" className={styles.notice}>
          {notice}
        </p>
      )}
      {saver.error !== null && (
        <p role="alert" className={styles.error}>
          {saver.error}
        </p>
      )}

      {entries.length === 0 ? (
        <EmptyState icon={<Scale />} title={t.emptyTitle} text={t.emptyText} />
      ) : (
        <>
          <div className={progressStyles.periods} role="group" aria-label={strings.progressPage.period}>
            {PERIODS.map((p) => (
              <button
                key={p}
                type="button"
                className={[progressStyles.period, p === period && progressStyles.periodActive].filter(Boolean).join(' ')}
                aria-pressed={p === period}
                aria-label={strings.progressPage.periodLabels[p]}
                onClick={() => {
                  const next = new URLSearchParams(searchParams);
                  next.set('periode', p);
                  setSearchParams(next, { replace: true });
                }}
              >
                {strings.progressPage.periods[p]}
              </button>
            ))}
          </div>

          <Card className={progressStyles.chartCard}>
            <Eyebrow>{t.chartTitle}</Eyebrow>
            {series.points.length === 0 ? (
              <p className={progressStyles.emptyPeriod}>{t.noPointsInPeriod}</p>
            ) : (
              <ProgressChart
                series={series}
                label={t.chartLabel(series.points.length)}
                formatValue={formatKg}
                selectedId={visibleSelected}
                onSelect={onSelect}
                valueAxisFor={weightValueAxis}
                pointLabel={pointLabel}
              />
            )}
          </Card>

          {selectedEntry ? (
            <WeightPointCard
              entry={selectedEntry}
              delta={weightDelta(entries, selectedEntry.date)}
              previous={previousWeight(entries, selectedEntry.date)}
              onEdit={() => {
                onEdit(selectedEntry);
              }}
              onClose={() => {
                setSelectedDate(null);
              }}
            />
          ) : (
            series.points.length > 0 && <p className={progressStyles.hint}>{t.tapHint}</p>
          )}

          <WeightStatsCard stats={stats} previousOfLast={latest ? previousWeight(entries, latest.date) : null} />

          <Card aria-labelledby="weights-title">
            <Eyebrow id="weights-title">{t.list}</Eyebrow>
            <ul className={styles.list}>
              {[...entries].reverse().map((entry) => (
                <li key={entry.date} className={styles.row}>
                  <span className={styles.rowText}>
                    <span className={styles.rowDate}>{formatDayLong(entry.date)}</span>
                    <span className={styles.rowValue}>{formatKg(entry.weightKg)}</span>
                  </span>
                  <button
                    type="button"
                    className={styles.rowAction}
                    aria-label={t.editLabel(formatDayLong(entry.date))}
                    onClick={() => {
                      onEdit(entry);
                    }}
                  >
                    <Pencil aria-hidden />
                  </button>
                  <button
                    type="button"
                    className={`${styles.rowAction ?? ''} ${styles.rowDelete ?? ''}`}
                    aria-label={t.deleteLabel(formatDayLong(entry.date))}
                    onClick={() => {
                      setDeleting(entry);
                    }}
                  >
                    <Trash2 aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}

      {adding && (
        <WeightFormSheet
          mode="add"
          today={today}
          busy={saver.busy}
          onClose={onCloseAdd}
          onSubmit={(date, weightKg) => {
            onNotice(null);
            saver.submit({
              mode: 'add',
              date,
              weightKg,
              onSaved: (message) => {
                onCloseAdd();
                onNotice(message);
              },
            });
          }}
        />
      )}
      {editing && (
        <WeightFormSheet
          mode="edit"
          today={today}
          entry={editing}
          busy={saver.busy}
          onClose={onCloseEdit}
          onSubmit={(date, weightKg) => {
            onNotice(null);
            saver.submit({
              mode: 'edit',
              date,
              weightKg,
              onSaved: (message) => {
                onCloseEdit();
                onNotice(message);
              },
            });
          }}
        />
      )}
      {saver.confirmation}
      {deleting && (
        <ConfirmSheet
          title={t.deleteTitle(formatDayLong(deleting.date), formatKg(deleting.weightKg))}
          confirmLabel={t.deleteConfirm}
          confirmVariant="danger"
          onConfirm={() => {
            const target = deleting;
            setDeleting(null);
            void deleteWeight(target.date).then(() => {
              onNotice(t.deleted(formatDayLong(target.date)));
            });
          }}
          onCancel={() => {
            setDeleting(null);
          }}
        >
          <p>{t.deleteText}</p>
        </ConfirmSheet>
      )}
    </>
  );
}

/** Champ décimal du poids (17 px, clavier décimal, unité « kg »). */
function WeightInput({ id, label, value, placeholder, invalid, describedBy, onChange }: {
  id: string;
  label: string;
  value: string;
  placeholder?: string;
  invalid: boolean;
  describedBy?: string;
  onChange: (value: string) => void;
}) {
  return (
    <span className={fieldStyles.control}>
      <input
        id={id}
        className={`${fieldStyles.input ?? ''} ${styles.weightInput ?? ''}`}
        type="text"
        inputMode="decimal"
        enterKeyHint="done"
        autoComplete="off"
        aria-label={label}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
        }}
      />
      <span className={fieldStyles.unit} aria-hidden>
        {t.unit}
      </span>
    </span>
  );
}

/** Carte « Nouvelle pesée » : le dernier poids est un PLACEHOLDER gris, jamais une valeur préremplie. */
function TodayCard({ today, placeholder, busy, onSubmit }: { today: string; placeholder: string; busy: boolean; onSubmit: (weightKg: number, reset: () => void) => void }) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();
  const errorId = useId();

  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    const parsed = parseWeightInput(text);
    if (!parsed.ok) {
      setError(t.inputErrors[parsed.error]);
      return;
    }
    setError(null);
    onSubmit(parsed.value, () => {
      setText('');
    });
  };

  return (
    <Card aria-labelledby="new-weight-title">
      <form className={styles.form} onSubmit={submit} noValidate>
        <Eyebrow id="new-weight-title">{t.newEntry}</Eyebrow>
        <div className={styles.inline}>
          <WeightInput
            id={inputId}
            label={t.todayLabel}
            value={text}
            placeholder={placeholder}
            invalid={error !== null}
            describedBy={error !== null ? errorId : undefined}
            onChange={(v) => {
              setText(v);
              setError(null);
            }}
          />
          <Button type="submit" loading={busy}>
            {t.save}
          </Button>
        </div>
        {error !== null && (
          <p id={errorId} role="alert" className={styles.fieldError}>
            {error}
          </p>
        )}
        <p className={styles.hint}>{t.autoDate(formatDayLong(today))}</p>
      </form>
    </Card>
  );
}

/** Feuille « Ajouter une pesée » (date au choix, jamais future) ou « Modifier la pesée » (poids seul). */
function WeightFormSheet({ mode, today, entry, busy, onClose, onSubmit }: {
  mode: 'add' | 'edit';
  today: string;
  entry?: WeightEntry;
  busy: boolean;
  onClose: () => void;
  onSubmit: (date: string, weightKg: number) => void;
}) {
  const [date, setDate] = useState(entry?.date ?? today);
  const [text, setText] = useState(entry ? formatDecimal(entry.weightKg) : '');
  const [dateError, setDateError] = useState<string | null>(null);
  const [weightError, setWeightError] = useState<string | null>(null);
  const dateId = useId();
  const weightId = useId();
  const errorId = useId();

  const submit = (event?: SyntheticEvent) => {
    event?.preventDefault();
    const dateProblem = mode === 'add' ? validateWeightDate(date, today) : null;
    const parsed = parseWeightInput(text);
    setDateError(dateProblem === 'future' ? t.futureDate : dateProblem === 'invalid' ? t.invalidDate : null);
    setWeightError(parsed.ok ? null : t.inputErrors[parsed.error]);
    if (dateProblem !== null || !parsed.ok) return;
    onSubmit(date, parsed.value);
  };

  return (
    <Sheet
      title={mode === 'add' ? t.add : t.editTitle}
      icon={mode === 'add' ? <Plus aria-hidden /> : <Pencil aria-hidden />}
      onClose={onClose}
      dismissible={!busy}
      footer={
        <>
          <Button size="lg" fullWidth loading={busy} onClick={() => {
            submit();
          }}>
            {mode === 'add' ? t.addConfirm : t.editConfirm}
          </Button>
          <Button variant="ghost" fullWidth onClick={onClose} disabled={busy}>
            {strings.common.cancel}
          </Button>
        </>
      }
    >
      <form className={styles.form} onSubmit={submit} noValidate>
        {mode === 'add' ? (
          <label className={styles.field} htmlFor={dateId}>
            <span className={styles.fieldLabel}>{t.dateLabel}</span>
            <input
              id={dateId}
              className={`${fieldStyles.input ?? ''} ${styles.dateInput ?? ''}`}
              type="date"
              max={today}
              value={date}
              aria-invalid={dateError !== null || undefined}
              onChange={(e) => {
                setDate(e.target.value);
                setDateError(null);
              }}
            />
          </label>
        ) : (
          entry && <p className={styles.hint}>{t.editIntro(formatDayLong(entry.date))}</p>
        )}
        {dateError !== null && (
          <p role="alert" className={styles.fieldError}>
            {dateError}
          </p>
        )}
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor={weightId}>
            {t.weightLabel}
          </label>
          <WeightInput
            id={weightId}
            label={t.weightLabel}
            value={text}
            invalid={weightError !== null}
            describedBy={weightError !== null ? errorId : undefined}
            onChange={(v) => {
              setText(v);
              setWeightError(null);
            }}
          />
        </div>
        {weightError !== null && (
          <p id={errorId} role="alert" className={styles.fieldError}>
            {weightError}
          </p>
        )}
      </form>
    </Sheet>
  );
}

/** Carte de détail d'un point : date, poids, écart avec la pesée précédente, crayon. */
function WeightPointCard({ entry, delta, previous, onEdit, onClose }: {
  entry: WeightEntry;
  delta: number | null;
  previous: WeightEntry | null;
  onEdit: () => void;
  onClose: () => void;
}) {
  const cardRef = useRef<HTMLElement>(null);
  // Carte entièrement visible au-dessus de la barre basse (scroll-margin-bottom, cf. progression).
  useEffect(() => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    cardRef.current?.scrollIntoView({ block: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' });
  }, [entry.date]);
  return (
    <Card ref={cardRef} className={progressStyles.pointCard} aria-labelledby="weight-point-title" aria-live="polite">
      <div className={progressStyles.pointHeader}>
        <p id="weight-point-title" className={progressStyles.pointDate}>
          {formatDayLong(entry.date)}
        </p>
        <button type="button" className={progressStyles.closeButton} aria-label={strings.common.close} onClick={onClose}>
          <X aria-hidden />
        </button>
      </div>
      <p className={progressStyles.pointValue}>
        <span className={progressStyles.pointValueLabel}>{t.pointValue}</span>
        {formatKg(entry.weightKg)}
      </p>
      <p className={styles.pointDelta}>
        <span className={progressStyles.muted}>{t.pointDelta} : </span>
        {delta !== null && previous ? t.deltaSince(formatSignedKg(delta), formatDayShort(previous.date)) : t.firstEntry}
      </p>
      <Button variant="secondary" fullWidth icon={<Pencil aria-hidden />} onClick={onEdit}>
        {t.editLabel(formatDayLong(entry.date))}
      </Button>
    </Card>
  );
}

/** Statistiques factuelles : dernier poids et son écart, min, max, variation sur la période. */
function WeightStatsCard({ stats, previousOfLast }: { stats: ReturnType<typeof weightStats>; previousOfLast: WeightEntry | null }) {
  const { last, min, max, change, firstDate, lastDate, count } = stats;
  return (
    <Card aria-labelledby="weight-stats-title" className={progressStyles.stats}>
      <div>
        <Eyebrow id="weight-stats-title">{t.lastWeight}</Eyebrow>
        <p className={progressStyles.bigValue}>{last ? formatKg(last.weightKg) : '—'}</p>
        {last && (
          <p className={progressStyles.delta}>
            {last.delta !== null && previousOfLast ? t.deltaSince(formatSignedKg(last.delta), formatDayShort(previousOfLast.date)) : t.firstEntry}
          </p>
        )}
      </div>
      <dl className={progressStyles.statGrid}>
        <div>
          <dt>{t.min}</dt>
          <dd>{min ? formatKg(min.weightKg) : '—'}</dd>
          {min && <dd className={progressStyles.statSub}>{formatDayShort(min.date)}</dd>}
        </div>
        <div>
          <dt>{t.max}</dt>
          <dd>{max ? formatKg(max.weightKg) : '—'}</dd>
          {max && <dd className={progressStyles.statSub}>{formatDayShort(max.date)}</dd>}
        </div>
        <div>
          <dt>{t.change}</dt>
          <dd>{change !== null ? formatSignedKg(change) : '—'}</dd>
          {change !== null && firstDate && lastDate && (
            <dd className={progressStyles.statSub}>{t.changeOver(daysBetween(firstDate, lastDate))}</dd>
          )}
        </div>
      </dl>
      <p className={styles.hint}>{t.periodStats(count)}</p>
    </Card>
  );
}
