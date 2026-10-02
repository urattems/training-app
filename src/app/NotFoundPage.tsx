import { Link } from 'react-router';
import { Compass } from 'lucide-react';
import { EmptyState } from '../components/EmptyState';
import { Page } from '../components/Page';
import { strings } from '../i18n/strings';
import styles from './NotFoundPage.module.css';

export function NotFoundPage() {
  return (
    <Page title={strings.errors.notFoundTitle}>
      <EmptyState icon={<Compass />} title={strings.errors.notFoundTitle} text={strings.errors.notFoundText}>
        <Link to="/" className={styles.link}>
          {strings.errors.backHome}
        </Link>
      </EmptyState>
    </Page>
  );
}
