import type { ReactNode } from 'react';
import { ChevronLeft } from 'lucide-react';
import { Link } from 'react-router';
import { strings } from '../i18n/strings';
import styles from './Page.module.css';

interface PageProps {
  title: string;
  /** Ligne secondaire sous le titre (ex. « Commencée à 18:02 »). */
  subtitle?: ReactNode;
  /** Lien de retour (ex. Paramètres → Accueil). */
  backTo?: string;
  backLabel?: string;
  /** Action à droite du titre, sur la même ligne (ex. roue crantée). */
  trailing?: ReactNode;
  children: ReactNode;
}

/** Gabarit d'écran : grand titre iOS, contenu centré, marges et safe areas. */
export function Page({ title, subtitle, backTo, backLabel = strings.nav.back, trailing, children }: PageProps) {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        {backTo && (
          <div className={styles.backRow}>
            <Link to={backTo} className={styles.backLink}>
              <ChevronLeft aria-hidden />
              <span>{backLabel}</span>
            </Link>
          </div>
        )}
        <div className={styles.titleRow}>
          <h1 className={styles.title}>{title}</h1>
          {trailing && <div className={styles.trailing}>{trailing}</div>}
        </div>
        {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
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
