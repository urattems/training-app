import { useId, useMemo, useState, type SyntheticEvent } from 'react';
import { Pencil, Plus, Ruler, Trash2 } from 'lucide-react';
import { Button } from '../../components/Button';
import { Card, Eyebrow } from '../../components/Card';
import { ConfirmSheet } from '../../components/ConfirmSheet';
import { EmptyState } from '../../components/EmptyState';
import fieldStyles from '../../components/Field.module.css';
import { LoadingState } from '../../components/LoadingState';
import { Page } from '../../components/Page';
import { Sheet } from '../../components/Sheet';
import {
  latestValue,
  MEASUREMENT_ZONES,
  measurementTotal,
  measurementValueError,
  measurementWarnings,
  sortMeasurements,
  type MeasurementValues,
  type MeasurementWarning,
  type MeasurementZoneKey,
} from '../../domain/measurements';
import type { MeasurementEntry } from '../../domain/types';
import { validateWeightDate } from '../../domain/weight';
import { useMeasurements } from '../../hooks/useData';
import { useToday } from '../../hooks/useToday';
import { strings } from '../../i18n/strings';
import { addMeasurement, deleteMeasurement, updateMeasurement } from '../../services/measurementService';
import { toDisplayError } from '../../utils/errors';
import { formatDayLong, formatDayShort } from '../../utils/format';
import { formatCm, formatDecimal, parseDecimalInput } from '../../utils/numbers';
import { BodyTabs } from './BodyTabs';
import { DecimalInput } from './DecimalInput';
import { MeasurementsOverview } from './MeasurementsOverview';
import styles from './MeasurementsPage.module.css';
import weightStyles from './WeightPage.module.css';

const t = strings.measurements;
const ZONE_LABEL = Object.fromEntries(MEASUREMENT_ZONES.map((z) => [z.key, z.label])) as Record<MeasurementZoneKey, string>;

type Texts = Record<MeasurementZoneKey, string>;
const EMPTY_TEXTS = Object.fromEntries(MEASUREMENT_ZONES.map((z) => [z.key, ''])) as Texts;
const EMPTY_VALUES: MeasurementValues = { chestCm: null, bellyCm: null, waistCm: null, bicepsCm: null, thighCm: null, calfCm: null };

/**
 * Texte saisi → mesure : vide = absente (`null`, jamais 0) ; message précis sinon (jamais d'arrondi).
 * `definitive` : aucune frappe de plus ne peut corriger la saisie (3ᵉ décimale, plus de 300 cm) ;
 * le message s'affiche alors tout de suite sous le champ (V1.6.1), sans attendre « Enregistrer ».
 */
function readField(text: string, label: string): { ok: true; value: number | null } | { ok: false; error: string; definitive: boolean } {
  const parsed = parseDecimalInput(text);
  if (!parsed.ok) return { ok: false, error: t.unreadable(label), definitive: false };
  if (parsed.value === null) return { ok: true, value: null };
  const error = measurementValueError(parsed.value);
  return error === null
    ? { ok: true, value: parsed.value }
    : { ok: false, error: t.valueErrors[error](label), definitive: error === 'too_precise' || error === 'too_large' };
}

type FormTarget = { mode: 'add' } | { mode: 'edit'; entry: MeasurementEntry };

/**
 * Sous-onglet « Mensurations » de l'onglet Poids (V1.6.0) : saisie d'une prise (6 zones, au moins
 * une), graphique d'une zone à la fois, dernière mensuration, historique. Aucun score, aucun objectif.
 */
export default function MeasurementsPage() {
  const entries = useMeasurements();
  const [form, setForm] = useState<FormTarget | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<MeasurementEntry | null>(null);

  return (
    <Page title={strings.weight.title}>
      <BodyTabs />
      <Button
        variant="secondary"
        fullWidth
        icon={<Plus aria-hidden />}
        onClick={() => {
          setNotice(null);
          setForm({ mode: 'add' });
        }}
      >
        {t.add}
      </Button>
      {notice !== null && (
        <p role="status" className={weightStyles.notice}>
          {notice}
        </p>
      )}
      {entries === undefined ? (
        <LoadingState />
      ) : entries.length === 0 ? (
        <EmptyState icon={<Ruler />} title={t.emptyTitle} text={t.emptyText} />
      ) : (
        <>
          <MeasurementsOverview
            entries={entries}
            onEdit={(entry) => {
              setNotice(null);
              setForm({ mode: 'edit', entry });
            }}
          />
          <HistoryCard
            entries={entries}
            onEdit={(entry) => {
              setNotice(null);
              setForm({ mode: 'edit', entry });
            }}
            onDelete={setDeleting}
          />
        </>
      )}

      {form !== null && entries !== undefined && (
        <MeasurementFormSheet
          key={form.mode === 'edit' ? `edit-${form.entry.date}` : 'add'}
          target={form}
          entries={entries}
          onClose={() => {
            setForm(null);
          }}
          onEditExisting={(entry) => {
            setForm({ mode: 'edit', entry });
          }}
          onSaved={(message) => {
            setForm(null);
            setNotice(message);
          }}
        />
      )}
      {deleting && (
        <ConfirmSheet
          title={t.deleteTitle(formatDayLong(deleting.date))}
          confirmLabel={t.deleteConfirm}
          confirmVariant="danger"
          onConfirm={() => {
            const target = deleting;
            setDeleting(null);
            void deleteMeasurement(target.date).then(() => {
              setNotice(t.deleted(formatDayLong(target.date)));
            });
          }}
          onCancel={() => {
            setDeleting(null);
          }}
        >
          <p>{t.deleteText}</p>
        </ConfirmSheet>
      )}
    </Page>
  );
}

/** Historique : une ligne par prise, du plus récent au plus ancien ; crayon et poubelle (≥ 44 px). */
function HistoryCard({ entries, onEdit, onDelete }: { entries: MeasurementEntry[]; onEdit: (e: MeasurementEntry) => void; onDelete: (e: MeasurementEntry) => void }) {
  return (
    <Card aria-labelledby="measurements-history-title">
      <Eyebrow id="measurements-history-title">{t.history}</Eyebrow>
      <ul className={weightStyles.list}>
        {sortMeasurements(entries)
          .reverse()
          .map((entry) => {
            const total = measurementTotal(entry);
            const date = formatDayLong(entry.date);
            return (
              <li key={entry.date} className={`${weightStyles.row ?? ''} ${styles.historyRow ?? ''}`}>
                <div className={weightStyles.rowText}>
                  <span className={weightStyles.rowDate}>{date}</span>
                  <dl className={styles.values}>
                    {MEASUREMENT_ZONES.map((zone) => (
                      <div key={zone.key}>
                        <dt>{zone.label}</dt>
                        <dd>{entry[zone.key] === null ? '—' : formatDecimal(entry[zone.key] ?? 0)}</dd>
                      </div>
                    ))}
                  </dl>
                  <span className={styles.rowTotal}>
                    {total === null ? (
                      t.incomplete
                    ) : (
                      <>
                        {t.total}
                        {/* Espace insécable : jamais de retour à la ligne avant les deux-points. */}
                        {'\u00a0: '}
                        <span className={styles.nowrap}>{formatCm(total)}</span>
                      </>
                    )}
                  </span>
                </div>
                <button
                  type="button"
                  className={weightStyles.rowAction}
                  aria-label={t.editLabel(date)}
                  onClick={() => {
                    onEdit(entry);
                  }}
                >
                  <Pencil aria-hidden />
                </button>
                <button
                  type="button"
                  className={`${weightStyles.rowAction ?? ''} ${weightStyles.rowDelete ?? ''}`}
                  aria-label={t.deleteLabel(date)}
                  onClick={() => {
                    onDelete(entry);
                  }}
                >
                  <Trash2 aria-hidden />
                </button>
              </li>
            );
          })}
      </ul>
    </Card>
  );
}

/**
 * Feuille « Nouvelle mensuration » ou « Modifier la prise ». Ajout : date (aujourd'hui par défaut,
 * jamais future), 6 champs VIDES (dernière valeur en placeholder, jamais préremplie). Modification :
 * date fixe, valeurs réelles préremplies (édition explicite).
 */
function MeasurementFormSheet({ target, entries, onClose, onEditExisting, onSaved }: {
  target: FormTarget;
  entries: MeasurementEntry[];
  onClose: () => void;
  onEditExisting: (entry: MeasurementEntry) => void;
  onSaved: (message: string) => void;
}) {
  const today = useToday();
  const editing = target.mode === 'edit' ? target.entry : null;
  const [date, setDate] = useState(editing?.date ?? today);
  const [texts, setTexts] = useState<Texts>(() =>
    editing ? (Object.fromEntries(MEASUREMENT_ZONES.map((z) => [z.key, editing[z.key] === null ? '' : formatDecimal(editing[z.key] ?? 0)])) as Texts) : EMPTY_TEXTS,
  );
  const [errors, setErrors] = useState<Partial<Record<MeasurementZoneKey, string>>>({});
  const [dateError, setDateError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<{ list: MeasurementWarning[]; values: MeasurementValues } | null>(null);
  const [busy, setBusy] = useState(false);
  const dateId = useId();
  const baseId = useId();

  const existing = editing ? null : (entries.find((e) => e.date === date) ?? null);
  const readAll = useMemo(() => MEASUREMENT_ZONES.map((z) => ({ zone: z, read: readField(texts[z.key], z.label) })), [texts]);
  const hasValidValue = readAll.some(({ read }) => read.ok && read.value !== null);

  const write = async (values: MeasurementValues) => {
    setBusy(true);
    setFormError(null);
    try {
      if (editing) {
        await updateMeasurement(editing.date, values);
        onSaved(t.updated(formatDayLong(editing.date)));
      } else {
        await addMeasurement(date, values);
        onSaved(t.saved(formatDayLong(date)));
      }
    } catch (e) {
      setWarnings(null);
      setFormError(toDisplayError(e, t.error).message);
    } finally {
      setBusy(false);
    }
  };

  const submit = (event?: SyntheticEvent) => {
    event?.preventDefault();
    const dateProblem = editing ? null : validateWeightDate(date, today);
    setDateError(dateProblem === 'future' ? t.futureDate : dateProblem === 'invalid' ? t.invalidDate : null);
    const nextErrors: Partial<Record<MeasurementZoneKey, string>> = {};
    const values = { ...EMPTY_VALUES };
    for (const { zone, read } of readAll) {
      if (read.ok) values[zone.key] = read.value;
      else nextErrors[zone.key] = read.error;
    }
    setErrors(nextErrors);
    if (dateProblem !== null || Object.keys(nextErrors).length > 0 || existing) return;
    if (!MEASUREMENT_ZONES.some((z) => values[z.key] !== null)) {
      setFormError(t.empty);
      return;
    }
    const others = entries.filter((e) => e.date !== (editing?.date ?? date));
    const list = measurementWarnings(others, editing?.date ?? date, values);
    if (list.length > 0) {
      setWarnings({ list, values });
      return;
    }
    void write(values);
  };

  return (
    <>
      <Sheet
        title={editing ? t.editTitle : t.newTitle}
        icon={editing ? <Pencil aria-hidden /> : <Plus aria-hidden />}
        onClose={onClose}
        dismissible={!busy}
        footer={
          <>
            <Button size="lg" fullWidth loading={busy} disabled={!hasValidValue || existing !== null} onClick={() => {
              submit();
            }}>
              {t.save}
            </Button>
            <Button variant="ghost" fullWidth onClick={onClose} disabled={busy}>
              {strings.common.cancel}
            </Button>
          </>
        }
      >
        <form className={weightStyles.form} onSubmit={submit} noValidate>
          {editing ? (
            <p className={weightStyles.hint}>{t.editIntro(formatDayLong(editing.date))}</p>
          ) : (
            <label className={weightStyles.field} htmlFor={dateId}>
              <span className={weightStyles.fieldLabel}>{t.dateLabel}</span>
              <input
                id={dateId}
                className={`${fieldStyles.input ?? ''} ${weightStyles.dateInput ?? ''}`}
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
          )}
          {dateError !== null && (
            <p role="alert" className={weightStyles.fieldError}>
              {dateError}
            </p>
          )}
          {existing && (
            <div role="alert" className={styles.existing}>
              <p>{t.existsOn(formatDayLong(existing.date))}</p>
              <Button variant="secondary" fullWidth icon={<Pencil aria-hidden />} onClick={() => {
                onEditExisting(existing);
              }}>
                {t.editExisting}
              </Button>
            </div>
          )}
          <p className={weightStyles.hint}>{t.help}</p>
          <details className={styles.howTo}>
            <summary>{t.howTo}</summary>
            <dl>
              {MEASUREMENT_ZONES.map((zone) => (
                <div key={zone.key}>
                  <dt>{zone.label}</dt>
                  <dd>{zone.instruction}</dd>
                </div>
              ))}
            </dl>
          </details>
          {MEASUREMENT_ZONES.map((zone) => {
            const id = `${baseId}-${zone.key}`;
            const read = readAll.find((r) => r.zone.key === zone.key)?.read;
            // Erreur de l'envoi, sinon erreur définitive affichée dès la frappe (jamais un bouton grisé sans explication).
            const error = errors[zone.key] ?? (read && !read.ok && read.definitive ? read.error : undefined);
            const last = latestValue(entries, zone.key);
            return (
              <div key={zone.key} className={weightStyles.field}>
                <label className={weightStyles.fieldLabel} htmlFor={id}>
                  {zone.label}
                </label>
                <DecimalInput
                  id={id}
                  label={t.fieldLabel(zone.label)}
                  unit={t.unit}
                  className={weightStyles.weightInput}
                  placeholder={last ? formatDecimal(last.value) : undefined}
                  invalid={error !== undefined}
                  describedBy={error !== undefined ? `${id}-error` : undefined}
                  scrollOnFocus
                  value={texts[zone.key]}
                  onChange={(value) => {
                    setTexts((current) => ({ ...current, [zone.key]: value }));
                    setErrors((current) => ({ ...current, [zone.key]: undefined }));
                    setFormError(null);
                  }}
                />
                {error !== undefined && (
                  <p id={`${id}-error`} role="alert" className={weightStyles.fieldError}>
                    {error}
                  </p>
                )}
              </div>
            );
          })}
          {formError !== null && (
            <p role="alert" className={weightStyles.fieldError}>
              {formError}
            </p>
          )}
        </form>
      </Sheet>
      {warnings && (
        <ConfirmSheet
          title={t.sanityTitle}
          confirmLabel={t.sanityConfirm}
          cancelLabel={t.sanityCancel}
          busy={busy}
          onConfirm={() => {
            void write(warnings.values);
          }}
          onCancel={() => {
            setWarnings(null);
          }}
        >
          {warnings.list.map((w) => (
            <p key={w.zone}>{t.sanityLine(ZONE_LABEL[w.zone], formatCm(w.value), formatCm(w.previous.value), formatDayShort(w.previous.date))}</p>
          ))}
        </ConfirmSheet>
      )}
    </>
  );
}

