import { useId, useState, type ReactNode } from 'react';
import { Check } from 'lucide-react';
import { strings } from '../i18n/strings';
import { writeClipboardText } from '../utils/clipboard';
import { Button, type ButtonVariant } from './Button';
import styles from './CopyTextButton.module.css';

interface CopyTextButtonProps {
  /** Texte copié, préparé à l'avance : l'écriture part tout de suite, dans le geste. */
  text: string;
  label: string;
  icon?: ReactNode;
  variant?: ButtonVariant;
  size?: 'md' | 'lg';
}

/**
 * Bouton « Copier » (V1.8.0) : confirmation visible « Copié » (sans minuteur) ; si le
 * presse-papiers est absent ou refusé, le texte s'affiche, sélectionnable, pour une copie à la main.
 */
export function CopyTextButton({ text, label, icon, variant = 'primary', size = 'md' }: CopyTextButtonProps) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  const fieldId = useId();

  const copy = async () => {
    setStatus((await writeClipboardText(text)) ? 'copied' : 'failed');
  };

  return (
    <div className={styles.copy}>
      <Button
        variant={variant}
        size={size}
        fullWidth
        icon={icon}
        onClick={() => {
          void copy();
        }}
      >
        {label}
      </Button>
      <p role="status" className={styles.status}>
        {status === 'copied' && (
          <>
            <Check aria-hidden className={styles.icon} /> {strings.copy.copied}
          </>
        )}
      </p>
      {status === 'failed' && (
        <div className={styles.manual}>
          <p role="alert" className={styles.failed}>
            {strings.copy.failed}
          </p>
          <label htmlFor={fieldId} className={styles.label}>
            {strings.copy.manualLabel}
          </label>
          <textarea
            id={fieldId}
            className={styles.text}
            readOnly
            value={text}
            rows={6}
            onFocus={(e) => {
              e.currentTarget.select();
            }}
          />
        </div>
      )}
    </div>
  );
}
