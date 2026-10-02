import type { ReactNode } from 'react';
import { ChevronLeft } from 'lucide-react';
import { Link } from 'react-router';
import { strings } from '../i18n/strings';
import styles from './Page.module.css';

interface PageProps {
  title: string;
  /** Lien de retour (ex. Paramètres → Accueil). */
  backTo?: string;
  /** Action en haut à droite (ex. roue crantée). */
  trailing?: ReactNode;
  children: ReactNode;
}

/** Gabarit d'écran : grand titre iOS, contenu centré, marges et safe areas. */
export function Page({ title, backTo, trailing, children }: PageProps) {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.topBar}>
          {backTo ? (
            <Link to={backTo} className={styles.iconButton} aria-label={strings.nav.back}>
              <ChevronLeft aria-hidden />
            </Link>
          ) : (
            <span />
          )}
          {trailing}
        </div>
        <h1 className={styles.title}>{title}</h1>
      </header>
      <div className={styles.content}>{children}</div>
    </div>
  );
}

export function IconLink({ to, label, children }: { to: string; label: string; children: ReactNode }) {
  return (
    <Link to={to} className={styles.iconButton} aria-label={label}>
      {children}
    </Link>
  );
}
