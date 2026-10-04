import { ChartLine, ClipboardList, House, Scale } from 'lucide-react';
import { NavLink } from 'react-router';
import { strings } from '../i18n/strings';
import styles from './TabBar.module.css';

const TABS = [
  { to: '/', label: strings.nav.home, icon: House, end: true },
  { to: '/program', label: strings.nav.program, icon: ClipboardList, end: false },
  { to: '/progress', label: strings.nav.progress, icon: ChartLine, end: false },
  { to: '/weight', label: strings.nav.weight, icon: Scale, end: false },
] as const;

/**
 * Barre basse à 4 onglets (SPEC §7.1, amendée en V1.2 : « Poids » après Progression).
 * Les Paramètres restent une roue crantée, jamais un onglet.
 */
export function TabBar() {
  return (
    <nav className={styles.tabBar} aria-label={strings.nav.mainNavigation}>
      {TABS.map(({ to, label, icon: Icon, end }) => (
        <NavLink key={to} to={to} end={end} className={({ isActive }) => [styles.tab, isActive && styles.active].filter(Boolean).join(' ')}>
          <Icon aria-hidden className={styles.icon} />
          <span className={styles.label}>{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
