import type { HTMLAttributes, Ref } from 'react';
import styles from './Card.module.css';

export function Card({ className, ref, ...rest }: HTMLAttributes<HTMLElement> & { ref?: Ref<HTMLElement> }) {
  return <section ref={ref} className={[styles.card, className].filter(Boolean).join(' ')} {...rest} />;
}

/** Petit titre de section en capitales (« PROGRAMME ACTIF »). */
export function Eyebrow({ className, ...rest }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={[styles.eyebrow, className].filter(Boolean).join(' ')} {...rest} />;
}
