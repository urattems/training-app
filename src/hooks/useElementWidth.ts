import { useEffect, useState, type RefObject } from 'react';

/** Largeur utilisée quand la mesure est impossible (ex. jsdom) : largeur utile d'un iPhone. */
const FALLBACK_WIDTH = 340;

/**
 * Largeur d'un élément, suivie avec ResizeObserver (rotation, redimensionnement).
 * Remplace ResponsiveContainer de Recharts, qui ne rend rien tant que la taille est inconnue.
 */
export function useElementWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(FALLBACK_WIDTH);
  useEffect(() => {
    const element = ref.current;
    if (!element || !('ResizeObserver' in window)) return;
    const observer = new ResizeObserver(([entry]) => {
      const measured = Math.floor(entry?.contentRect.width ?? 0);
      if (measured > 0) setWidth(measured);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [ref]);
  return width;
}
