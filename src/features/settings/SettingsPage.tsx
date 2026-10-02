import { lazy, Suspense } from 'react';
import { Card, Eyebrow } from '../../components/Card';
import { Page } from '../../components/Page';
import { APP_NAME, APP_VERSION } from '../../config';
import { strings } from '../../i18n/strings';
import { ImportProgramButton } from '../import/ImportProgramFlow';
import styles from './SettingsPage.module.css';

const t = strings.settings;

// Mode développement uniquement : `import.meta.env.DEV` vaut `false` au build de production,
// l'import dynamique est alors supprimé et DevTools n'est pas inclus dans dist/.
const DevTools = import.meta.env.DEV ? lazy(() => import('./DevTools')) : null;

/** Paramètres (SPEC §7.10). Export, restauration et préférences arrivent au J5. */
export function SettingsPage() {
  return (
    <Page title={t.title} backTo="/">
      <section className={styles.section} aria-labelledby="settings-data">
        <Eyebrow id="settings-data">{t.data}</Eyebrow>
        <Card className={styles.group}>
          <p className={styles.hint}>{t.importProgramHint}</p>
          <ImportProgramButton label={t.importProgram} variant="secondary" />
        </Card>
      </section>

      <section className={styles.section} aria-labelledby="settings-info">
        <Eyebrow id="settings-info">{t.info}</Eyebrow>
        <Card className={styles.group}>
          <dl className={styles.list}>
            <div className={styles.row}>
              <dt>{t.appName}</dt>
              <dd>{APP_NAME}</dd>
            </div>
            <div className={styles.row}>
              <dt>{t.version}</dt>
              <dd>{APP_VERSION}</dd>
            </div>
          </dl>
        </Card>
      </section>
      {DevTools && (
        <Suspense fallback={null}>
          <DevTools />
        </Suspense>
      )}
    </Page>
  );
}
