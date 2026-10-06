import type { FocusEvent } from 'react';
import fieldStyles from '../../components/Field.module.css';
import { scrollFieldIntoView } from '../../components/scrollFieldIntoView';

interface DecimalInputProps {
  id: string;
  /** Nom accessible du champ. */
  label: string;
  value: string;
  /** Unité affichée à droite (« kg », « cm »). */
  unit: string;
  placeholder?: string;
  invalid: boolean;
  describedBy?: string;
  /** Classe du champ (hauteur, marge pour l'unité). */
  className?: string;
  /** Garde le champ visible au-dessus du clavier iOS (formulaires à plusieurs champs). */
  scrollOnFocus?: boolean;
  onChange: (value: string) => void;
}

/**
 * Champ décimal commun au poids et aux mensurations (extrait de `WeightInput`, V1.6.0) :
 * texte libre (virgule ou point, interprété par `parseDecimalInput`), clavier décimal, « OK »
 * comme touche Entrée, aucune réécriture pendant la frappe. Le placeholder n'est jamais une valeur.
 */
export function DecimalInput({ id, label, value, unit, placeholder, invalid, describedBy, className, scrollOnFocus = false, onChange }: DecimalInputProps) {
  return (
    <span className={fieldStyles.control}>
      <input
        id={id}
        className={`${fieldStyles.input ?? ''} ${className ?? ''}`}
        type="text"
        inputMode="decimal"
        enterKeyHint="done"
        autoComplete="off"
        aria-label={label}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        placeholder={placeholder}
        value={value}
        onFocus={
          scrollOnFocus
            ? (event: FocusEvent<HTMLInputElement>) => {
                scrollFieldIntoView(event.currentTarget);
              }
            : undefined
        }
        onChange={(e) => {
          onChange(e.target.value);
        }}
      />
      <span className={fieldStyles.unit} aria-hidden>
        {unit}
      </span>
    </span>
  );
}
