import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import styles from './Sheet.module.css';

interface SheetProps {
  title: string;
  onClose: () => void;
  /** Empêche la fermeture (ex. écriture en cours). */
  dismissible?: boolean;
  icon?: ReactNode;
  tone?: 'neutral' | 'danger' | 'success';
  children: ReactNode;
  footer?: ReactNode;
}

/** Feuille modale en bas d'écran (iOS), accessible : focus, Échap, fond inerte. */
export function Sheet({ title, onClose, dismissible = true, icon, tone = 'neutral', children, footer }: SheetProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && dismissible) onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [dismissible, onClose]);

  return createPortal(
    <div className={styles.root}>
      <div
        className={styles.overlay}
        aria-hidden
        onClick={() => {
          if (dismissible) onClose();
        }}
      />
      <div
        ref={panelRef}
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className={styles.grabber} aria-hidden />
        <div className={styles.header}>
          {icon && <span className={`${styles.icon ?? ''} ${styles[tone] ?? ''}`}>{icon}</span>}
          <h2 id={titleId} className={styles.title}>
            {title}
          </h2>
        </div>
        <div className={styles.body}>{children}</div>
        {footer && <div className={styles.footer}>{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
