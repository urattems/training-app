import { matchPath, Outlet, useLocation } from 'react-router';
import { UpdateBanner } from '../pwa/UpdateBanner';
import { TabBar } from './TabBar';
import styles from './Shell.module.css';

/** La barre basse est masquée systématiquement sur l'écran exercice (SPEC §7.1). */
const isExerciseScreen = (pathname: string): boolean =>
  matchPath('/workout/:workoutId/exercise/:exerciseId', pathname) !== null;

export function Shell() {
  const { pathname } = useLocation();
  const showTabBar = !isExerciseScreen(pathname);
  return (
    <div className={showTabBar ? styles.withTabBar : undefined}>
      <UpdateBanner />
      <main>
        <Outlet />
      </main>
      {showTabBar && <TabBar />}
    </div>
  );
}
