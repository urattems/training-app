import { useEffect, useId, useLayoutEffect, useRef, type ReactNode } from 'react';
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

/** Feuilles ouvertes, de la plus ancienne à la plus récente : seule la dernière réagit au clavier. */
const openSheets: HTMLElement[] = [];

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const focusablesIn = (panel: HTMLElement): HTMLElement[] =>
  [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.closest('[inert]'));

/** L'application sous les feuilles est rendue inerte (clavier, lecteurs d'écran). */
const appRoot = (): HTMLElement | null => document.getElementById('root');

/**
 * Feuille modale en bas d'écran (iOS), accessible (SPEC §8) :
 * `role="dialog"`, `aria-modal`, libellée par son titre ; focus déplacé dans la feuille,
 * piégé (Tab / Maj+Tab) et rendu à l'élément déclencheur ; Échap ferme la feuille du dessus
 * uniquement ; fond inerte et non défilable.
 */
export function Sheet({ title, onClose, dismissible = true, icon, tone = 'neutral', children, footer }: SheetProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const dismissibleRef = useRef(dismissible);
  useEffect(() => {
    onCloseRef.current = onClose;
    dismissibleRef.current = dismissible;
  });

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    openSheets.push(panel);
    panel.focus();

    const root = appRoot();
    root?.setAttribute('inert', '');
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (event: KeyboardEvent) => {
      if (openSheets.at(-1) !== panel) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        if (dismissibleRef.current) onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusables = focusablesIn(panel);
      const first = focusables[0];
      const last = focusables.at(-1);
      const active = document.activeElement;
      if (!first || !last) {
        event.preventDefault();
        panel.focus();
      } else if (event.shiftKey && (active === first || active === panel || !panel.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !panel.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      const index = openSheets.indexOf(panel);
      if (index !== -1) openSheets.splice(index, 1);
      if (openSheets.length === 0) {
        root?.removeAttribute('inert');
        document.body.style.overflow = previousOverflow;
      }
      // Focus rendu au déclencheur, sauf si l'utilisateur l'a placé ailleurs (ex. « Compléter »).
      const active = document.activeElement;
      if (!active || active === document.body || panel.contains(active)) previouslyFocused?.focus();
    };
  }, []);

  return createPortal(
    <div className={styles.root}>
      <div
        className={styles.overlay}
        aria-hidden
        onClick={() => {
          if (dismissible) onClose();
        }}
      />
      <div ref={panelRef} className={styles.panel} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <div className={styles.grabber} aria-hidden />
        <div className={styles.header}>
          {icon && (
            <span className={`${styles.icon ?? ''} ${styles[tone] ?? ''}`} aria-hidden>
              {icon}
            </span>
          )}
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
