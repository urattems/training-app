import { useRef, useState, type MouseEvent, type PointerEvent, type ReactNode } from 'react';
import { Trash2 } from 'lucide-react';
import styles from './SwipeRow.module.css';

/** Largeur de l'action révélée (px) : cible tactile bien au-dessus de 44 px. */
export const SWIPE_ACTION_WIDTH = 88;
/** Déplacement minimal avant de choisir la direction du geste (px). */
export const SWIPE_LOCK_DISTANCE = 10;

type Mode = 'idle' | 'pending' | 'horizontal' | 'vertical';

interface SwipeRowProps {
  /** Ligne ouverte (action visible). Une seule ligne ouverte à la fois : état tenu par la liste. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Texte visible de l'action (« Supprimer »). */
  actionText: string;
  /** Nom accessible de l'action (VoiceOver), explicite sur la séance visée. */
  actionLabel: string;
  onAction: () => void;
  children: ReactNode;
}

/**
 * Ligne balayable vers la gauche, à la manière d'iOS (Mail, Messages), sans bibliothèque :
 * événements pointer natifs. Le geste ne prend la main qu'une fois clairement HORIZONTAL
 * (au-delà de 10 px, plus horizontal que vertical) ; sinon le défilement vertical continue
 * (`touch-action: pan-y`). Un balayage n'agit jamais seul : il révèle l'action, qu'il faut toucher.
 * Le tap simple garde son effet (ouvrir le détail) ; sur une ligne ouverte, il la referme.
 */
export function SwipeRow({ open, onOpenChange, actionText, actionLabel, onAction, children }: SwipeRowProps) {
  const [drag, setDrag] = useState<number | null>(null);
  const gesture = useRef<{ mode: Mode; x: number; y: number; base: number; offset: number }>({ mode: 'idle', x: 0, y: 0, base: 0, offset: 0 });
  const swallowClick = useRef(false);

  const offset = drag ?? (open ? -SWIPE_ACTION_WIDTH : 0);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    // Au toucher, un balayage n'est souvent suivi d'aucun clic : chaque geste repart de zéro.
    swallowClick.current = false;
    const base = open ? -SWIPE_ACTION_WIDTH : 0;
    gesture.current = { mode: 'pending', x: event.clientX, y: event.clientY, base, offset: base };
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (g.mode === 'idle' || g.mode === 'vertical') return;
    const dx = event.clientX - g.x;
    const dy = event.clientY - g.y;
    if (g.mode === 'pending') {
      if (Math.abs(dx) < SWIPE_LOCK_DISTANCE && Math.abs(dy) < SWIPE_LOCK_DISTANCE) return;
      if (Math.abs(dy) >= Math.abs(dx)) {
        g.mode = 'vertical'; // défilement : la ligne ne bouge pas
        return;
      }
      g.mode = 'horizontal';
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Absent de certains environnements (jsdom) : le geste fonctionne sans.
      }
    }
    g.offset = Math.min(0, Math.max(-SWIPE_ACTION_WIDTH, g.base + dx));
    setDrag(g.offset);
  };

  const end = (cancelled: boolean) => {
    const g = gesture.current;
    if (g.mode === 'horizontal') {
      swallowClick.current = true; // la fin d'un balayage n'est pas un tap
      if (!cancelled) onOpenChange(g.offset < -SWIPE_ACTION_WIDTH / 2);
    }
    gesture.current = { ...g, mode: 'idle' };
    setDrag(null);
  };

  const onClickCapture = (event: MouseEvent<HTMLDivElement>) => {
    if (swallowClick.current || open) {
      // Fin de balayage, ou tap sur une ligne ouverte : on referme, sans ouvrir le détail.
      event.preventDefault();
      event.stopPropagation();
      if (!swallowClick.current) onOpenChange(false);
    }
    swallowClick.current = false;
  };

  return (
    <div className={styles.swipe} data-open={open || undefined}>
      <div
        className={[styles.content, drag !== null && styles.dragging].filter(Boolean).join(' ')}
        style={{ transform: offset === 0 ? undefined : `translateX(${offset}px)` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => {
          end(false);
        }}
        onPointerCancel={() => {
          end(true);
        }}
        onClickCapture={onClickCapture}
      >
        {children}
      </div>
      <button
        type="button"
        className={styles.action}
        aria-label={actionLabel}
        // Clavier / VoiceOver : l'action reste atteignable sans geste ; la ligne s'ouvre au focus.
        onFocus={() => {
          if (!open) onOpenChange(true);
        }}
        onClick={onAction}
      >
        <Trash2 aria-hidden className={styles.icon} />
        <span>{actionText}</span>
      </button>
    </div>
  );
}
