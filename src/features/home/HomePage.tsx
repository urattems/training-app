import { ChevronRight, Dumbbell, Settings } from 'lucide-react';
import { Link } from 'react-router';
import { Card, Eyebrow } from '../../components/Card';
import { EmptyState } from '../../components/EmptyState';
import { LoadingState } from '../../components/LoadingState';
import { IconLink, Page } from '../../components/Page';
import { useActiveProgram } from '../../hooks/useData';
import { strings } from '../../i18n/strings';
import { ImportProgramButton } from '../import/ImportProgramFlow';
import styles from './HomePage.module.css';

const t = strings.home;

export function HomePage() {
  const program = useActiveProgram();

  return (
    <Page
      title={t.title}
      trailing={
        <IconLink to="/settings" label={strings.nav.settings}>
          <Settings aria-hidden />
        </IconLink>
      }
    >
      {program === undefined && <LoadingState />}

      {program === null && (
        <EmptyState icon={<Dumbbell />} title={t.welcomeTitle} text={t.welcomeText}>
          <ImportProgramButton size="lg" />
          <p className={styles.hint}>{t.installHint}</p>
        </EmptyState>
      )}

      {program && (
        <Card aria-labelledby="active-program-title">
          <Eyebrow>{t.activeProgram}</Eyebrow>
          <h2 id="active-program-title" className={styles.programName}>
            {program.name}
          </h2>
          <p className={styles.meta}>
            {[program.week.label, strings.common.sessions(program.sessions.length)].filter(Boolean).join(' · ')}
          </p>
          <Link to="/program" className={styles.rowLink}>
            <span>{t.seeProgram}</span>
            <ChevronRight aria-hidden />
          </Link>
        </Card>
      )}
    </Page>
  );
}
