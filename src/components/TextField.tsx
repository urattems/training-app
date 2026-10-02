import { useState, type FocusEvent } from 'react';
import { scrollFieldIntoView } from './scrollFieldIntoView';
import styles from './Field.module.css';

interface TextFieldProps {
  label: string;
  /** Libellé visible au-dessus du champ (sinon `label` est seulement accessible). */
  visibleLabel?: boolean;
  value: string;
  placeholder?: string;
  multiline?: boolean;
  /** Texte à persister : `immediate` au blur, sinon après le debounce. */
  onValueChange: (text: string, immediate: boolean) => void;
}

/** Champ texte à brouillon local : la saisie n'est jamais réécrite pendant la frappe. */
export function TextField({ label, visibleLabel = false, value, placeholder, multiline = false, onValueChange }: TextFieldProps) {
  const [draft, setDraft] = useState(value);
  const [lastValue, setLastValue] = useState(value);
  const [focused, setFocused] = useState(false);

  // Changement venu de la base : appliqué seulement hors saisie (cf. NumberField).
  if (value !== lastValue) {
    setLastValue(value);
    if (!focused) setDraft(value);
  }

  const common = {
    className: multiline ? `${styles.input ?? ''} ${styles.textarea ?? ''}` : styles.input,
    'aria-label': visibleLabel ? undefined : label,
    placeholder,
    value: draft,
    onFocus: (event: FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setFocused(true);
      scrollFieldIntoView(event.currentTarget);
    },
    onBlur: () => {
      setFocused(false);
      onValueChange(draft, true);
    },
  };
  const change = (text: string) => {
    setDraft(text);
    onValueChange(text, false);
  };

  const control = multiline ? (
    <textarea {...common} rows={3} onChange={(e) => {
      change(e.target.value);
    }} />
  ) : (
    <input {...common} type="text" autoComplete="off" enterKeyHint="done" onChange={(e) => {
      change(e.target.value);
    }} />
  );

  if (!visibleLabel) return <div className={styles.control}>{control}</div>;
  return (
    <label className={styles.labelled}>
      <span className={styles.label}>{label}</span>
      <span className={styles.control}>{control}</span>
    </label>
  );
}
