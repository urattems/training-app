import { useId, useState, type FocusEvent, type Ref } from 'react';
import { formatDecimal, parseDecimalInput, parseIntegerInput, type ParsedNumber } from '../utils/numbers';
import { scrollFieldIntoView } from './scrollFieldIntoView';
import styles from './Field.module.css';

interface NumberFieldProps {
  ref?: Ref<HTMLInputElement>;
  /** Libellé accessible (ex. « Série 1 — charge en kg »). */
  label: string;
  value: number | null;
  /** Objectif affiché en gris dans le champ vide (jamais une valeur). */
  placeholder?: string;
  mode: 'integer' | 'decimal';
  unit?: string;
  max?: number;
  invalidMessage: string;
  /** Garde-fou supplémentaire : message d'erreur précis pour une valeur lisible mais refusée. */
  check?: (value: number) => string | null;
  /** Valeur valide à persister, à chaque modification (`immediate` au blur : fin de saisie). */
  onValueChange: (value: number | null, immediate: boolean) => void;
  /** La saisie est devenue invalide : la valeur d'avant la saisie doit être rétablie en base. */
  onInvalidInput: () => void;
}

const toText = (value: number | null): string => (value === null ? '' : formatDecimal(value));

/** Saisie en cours non encore interprétable mais légitime (« 47, », « 47. », « , »). */
const isIncomplete = (text: string): boolean => /^\d*[.,]$/.test(text.trim());

/**
 * Champ numérique à brouillon local (SPEC §7.5) :
 * - le texte tapé n'est jamais réécrit pendant la saisie (« 47, » reste « 47, ») ;
 * - chaque valeur valide est persistée tout de suite (V1.3.2), et encore au blur ;
 * - une valeur invalide n'est jamais persistée ni effacée : le champ la garde et la signale,
 *   et la base revient à la valeur d'avant la saisie (pas de valeur intermédiaire, « 474 » pour « 4747 ») ;
 * - champ vidé → `null` (série non faite).
 */
export function NumberField({ ref, label, value, placeholder, mode, unit, max, invalidMessage, check, onValueChange, onInvalidInput }: NumberFieldProps) {
  const errorId = useId();
  const [draft, setDraft] = useState(() => toText(value));
  const [lastValue, setLastValue] = useState(value);
  const [focused, setFocused] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [message, setMessage] = useState(invalidMessage);

  // Changement venu de la base (ex. « Comme prévu ») : appliqué seulement hors saisie.
  // On suit les changements de `value`, jamais l'écart avec le brouillon : après un blur,
  // le champ garde la saisie tant que la base n'a pas encore reçu la nouvelle valeur.
  // Un champ en erreur garde la saisie de l'utilisateur jusqu'à sa correction.
  if (value !== lastValue) {
    setLastValue(value);
    if (!focused && !invalid) setDraft(toText(value));
  }

  /** Message d'erreur de la saisie, `null` si elle est valide (vide compris). */
  const errorOf = (parsed: ParsedNumber): string | null => {
    if (!parsed.ok) return invalidMessage;
    if (parsed.value === null) return null;
    if (max !== undefined && parsed.value > max) return invalidMessage;
    return check?.(parsed.value) ?? null;
  };

  const parse = (text: string): ParsedNumber => {
    const parsed = mode === 'integer' ? parseIntegerInput(text) : parseDecimalInput(text);
    const error = errorOf(parsed);
    if (error !== null) {
      setMessage(error);
      return { ok: false };
    }
    return parsed;
  };

  const onChange = (text: string) => {
    setDraft(text);
    const parsed = parse(text);
    if (parsed.ok) {
      setInvalid(false);
      onValueChange(parsed.value, false);
    } else if (!isIncomplete(text)) {
      // « 4,7,5 » : la valeur intermédiaire « 4,7 » ne doit pas être écrite.
      onInvalidInput();
    }
  };

  const onBlur = () => {
    setFocused(false);
    // « 47, » abandonné tel quel : la valeur entière est conservée (47).
    const text = isIncomplete(draft) && /\d/.test(draft) ? draft.trim().slice(0, -1) : draft;
    const parsed = parse(text);
    if (!parsed.ok) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setDraft(toText(parsed.value));
    onValueChange(parsed.value, true);
  };

  const onFocus = (event: FocusEvent<HTMLInputElement>) => {
    setFocused(true);
    event.currentTarget.select();
    scrollFieldIntoView(event.currentTarget);
  };

  return (
    <div className={styles.field}>
      <div className={[styles.control, invalid && styles.invalid].filter(Boolean).join(' ')}>
        <input
          ref={ref}
          className={styles.input}
          type="text"
          inputMode={mode === 'integer' ? 'numeric' : 'decimal'}
          pattern={mode === 'integer' ? '[0-9]*' : undefined}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="done"
          aria-label={label}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? errorId : undefined}
          placeholder={placeholder}
          value={draft}
          onChange={(e) => {
            onChange(e.target.value);
          }}
          onFocus={onFocus}
          onBlur={onBlur}
        />
        {unit && (
          <span className={styles.unit} aria-hidden>
            {unit}
          </span>
        )}
      </div>
      {invalid && (
        <p id={errorId} className={styles.error} role="alert">
          {message}
        </p>
      )}
    </div>
  );
}
