import type { HTMLAttributes } from 'react';
import styles from './Card.module.css';

export function Card({ className, ...rest }: HTMLAttributes<HTMLElement>) {
  return <section className={[styles.card, className].filter(Boolean).join(' ')} {...rest} />;
}

/** Petit titre de section en capitales (« PROGRAMME ACTIF »). */
export function Eyebrow({ className, ...rest }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={[styles.eyebrow, className].filter(Boolean).join(' ')} {...rest} />;
}
