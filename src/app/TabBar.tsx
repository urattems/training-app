import { ChartLine, ClipboardList, House } from 'lucide-react';
import { NavLink } from 'react-router';
import { strings } from '../i18n/strings';
import styles from './TabBar.module.css';

const TABS = [
  { to: '/', label: strings.nav.home, icon: House, end: true },
  { to: '/program', label: strings.nav.program, icon: ClipboardList, end: false },
  { to: '/progress', label: strings.nav.progress, icon: ChartLine, end: false },
] as const;

/** Barre basse à 3 onglets (SPEC §7.1). Les Paramètres ne sont jamais un 4e onglet. */
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
