import { HashRouter, Route, Routes } from 'react-router';
import { ExercisePage } from '../features/exercise/ExercisePage';
import { HistoryDetailPage } from '../features/history/HistoryDetailPage';
import { HistoryPage } from '../features/history/HistoryPage';
import { HomePage } from '../features/home/HomePage';
import { ImportProgramProvider } from '../features/import/ImportProgramFlow';
import { ProgramPage } from '../features/program/ProgramPage';
import { ProgramSessionPage } from '../features/program/ProgramSessionPage';
import { WorkoutPage } from '../features/workout/WorkoutPage';
import { ProgressPage } from '../features/progress/ProgressPage';
import { SettingsPage } from '../features/settings/SettingsPage';
import { ErrorBoundary } from './ErrorBoundary';
import { NotFoundPage } from './NotFoundPage';
import { Shell } from './Shell';

/** Routes de l'app (SPEC §7.1). Les écrans séance, historique et détail arrivent aux jalons suivants. */
export function AppRoutes() {
  return (
    <ImportProgramProvider>
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<HomePage />} />
          <Route path="program" element={<ProgramPage />} />
          <Route path="program/:sessionId" element={<ProgramSessionPage />} />
          <Route path="workout/:workoutId" element={<WorkoutPage />} />
          <Route path="workout/:workoutId/exercise/:exerciseId" element={<ExercisePage />} />
          <Route path="progress" element={<ProgressPage />} />
          <Route path="history" element={<HistoryPage />} />
          <Route path="history/:workoutId" element={<HistoryDetailPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </ImportProgramProvider>
  );
}

/** HashRouter : routes en `#/…`, fiables sur GitHub Pages et hors ligne (DECISIONS.md). */
export function App() {
  return (
    <ErrorBoundary>
      <HashRouter>
        <AppRoutes />
      </HashRouter>
    </ErrorBoundary>
  );
}
