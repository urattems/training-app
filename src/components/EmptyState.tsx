import type { ReactNode } from 'react';
import styles from './EmptyState.module.css';

interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  text?: string;
  children?: ReactNode;
}

export function EmptyState({ icon, title, text, children }: EmptyStateProps) {
  return (
    <div className={styles.empty}>
      <div className={styles.icon} aria-hidden>
        {icon}
      </div>
      <h2 className={styles.title}>{title}</h2>
      {text && <p className={styles.text}>{text}</p>}
      {children && <div className={styles.actions}>{children}</div>}
    </div>
  );
}
