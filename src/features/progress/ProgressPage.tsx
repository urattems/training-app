import { ChartLine } from 'lucide-react';
import { EmptyState } from '../../components/EmptyState';
import { LoadingState } from '../../components/LoadingState';
import { Page } from '../../components/Page';
import { useTrackedExercises } from '../../hooks/useData';
import { strings } from '../../i18n/strings';

const t = strings.progressPage;

/** Progression : graphique et statistiques au J4. Jamais de graphique vide (SPEC §7.9). */
export function ProgressPage() {
  const exercises = useTrackedExercises();
  return (
    <Page title={t.title}>
      {exercises === undefined && <LoadingState />}
      {exercises?.length === 0 && <EmptyState icon={<ChartLine />} title={t.emptyTitle} text={t.emptyText} />}
    </Page>
  );
}
