import { lazy, Suspense } from 'react';
import { HashRouter, Route, Routes } from 'react-router';
import { LoadingState } from '../components/LoadingState';
import { ExercisePage } from '../features/exercise/ExercisePage';
import { HistoryDetailPage } from '../features/history/HistoryDetailPage';
import { HistoryPage } from '../features/history/HistoryPage';
import { HomePage } from '../features/home/HomePage';
import { ImportProgramProvider } from '../features/import/ImportProgramFlow';
import { ProgramPage } from '../features/program/ProgramPage';
import { ProgramSessionPage } from '../features/program/ProgramSessionPage';
import { WorkoutPage } from '../features/workout/WorkoutPage';
import { CoachExportPage } from '../features/settings/CoachExportPage';
import { DrivePage } from '../features/settings/DrivePage';
import { SettingsPage } from '../features/settings/SettingsPage';
import { ConnectionNotice } from './ConnectionNotice';
import { DriveSyncAgent } from './DriveSyncAgent';
import { ErrorBoundary } from './ErrorBoundary';
import { NotFoundPage } from './NotFoundPage';
import { Shell } from './Shell';

// Progression et Poids (et Recharts, partagé) chargés à la demande : hors du bundle initial.
const ProgressPage = lazy(() => import('../features/progress/ProgressPage'));
const WeightPage = lazy(() => import('../features/weight/WeightPage'));
const MeasurementsPage = lazy(() => import('../features/weight/MeasurementsPage'));

const progress = (
  <Suspense fallback={<LoadingState />}>
    <ProgressPage />
  </Suspense>
);

const weight = (
  <Suspense fallback={<LoadingState />}>
    <WeightPage />
  </Suspense>
);
const measurements = (
  <Suspense fallback={<LoadingState />}>
    <MeasurementsPage />
  </Suspense>
);

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
          <Route path="progress" element={progress} />
          <Route path="progress/:exerciseId" element={progress} />
          <Route path="weight" element={weight} />
          <Route path="weight/mensurations" element={measurements} />
          <Route path="history" element={<HistoryPage />} />
          <Route path="history/:workoutId" element={<HistoryDetailPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="settings/coach" element={<CoachExportPage />} />
          <Route path="settings/drive" element={<DrivePage />} />
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
      <ConnectionNotice />
      <DriveSyncAgent />
    </ErrorBoundary>
  );
}
