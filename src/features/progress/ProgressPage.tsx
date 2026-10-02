import { ChartLine, History } from 'lucide-react';
import { EmptyState } from '../../components/EmptyState';
import { LoadingState } from '../../components/LoadingState';
import { IconLink, Page } from '../../components/Page';
import { useTrackedExercises } from '../../hooks/useData';
import { strings } from '../../i18n/strings';

const t = strings.progressPage;

/** Progression : graphique et statistiques au J4. Jamais de graphique vide (SPEC §7.9). */
export function ProgressPage() {
  const exercises = useTrackedExercises();
  return (
    <Page
      title={t.title}
      trailing={
        <IconLink to="/history" label={strings.history.link}>
          <History aria-hidden />
        </IconLink>
      }
    >
      {exercises === undefined && <LoadingState />}
      {exercises?.length === 0 && <EmptyState icon={<ChartLine />} title={t.emptyTitle} text={t.emptyText} />}
    </Page>
  );
}
