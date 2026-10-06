import { NavLink } from 'react-router';
import { strings } from '../../i18n/strings';
import styles from './BodyTabs.module.css';

const t = strings.measurements;

/**
 * Sous-onglets de l'onglet « Poids » (V1.6.0) : [ Poids | Mensurations ]. Deux liens
 * (`aria-current="page"` sur la vue affichée), zone tactile ≥ 44 px. L'onglet de la barre reste
 * « Poids » et actif sur les deux routes.
 */
export function BodyTabs() {
  const className = ({ isActive }: { isActive: boolean }) => [styles.tab, isActive && styles.active].filter(Boolean).join(' ');
  return (
    <nav className={styles.tabs} aria-label={t.tabsLabel}>
      <NavLink to="/weight" end className={className}>
        {t.tabWeight}
      </NavLink>
      <NavLink to="/weight/mensurations" className={className}>
        {t.tabMeasurements}
      </NavLink>
    </nav>
  );
}
