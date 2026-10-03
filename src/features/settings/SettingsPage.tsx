import { lazy, Suspense } from 'react';
import { Send } from 'lucide-react';
import { ButtonLink } from '../../components/Button';
import { Card, Eyebrow } from '../../components/Card';
import { Page } from '../../components/Page';
import { APP_BUILD, APP_NAME, APP_VERSION } from '../../config';
import { usePersistenceStatus } from '../../hooks/usePersistenceStatus';
import { usePreparedExport } from '../../hooks/usePreparedExport';
import { strings } from '../../i18n/strings';
import { ImportPasteButton, ImportProgramButton } from '../import/ImportProgramFlow';
import { ExportSection } from './ExportSection';
import { RestoreFlow } from './RestoreFlow';
import styles from './SettingsPage.module.css';

const t = strings.settings;

// Mode développement uniquement : `import.meta.env.DEV` vaut `false` au build de production,
// l'import dynamique est alors supprimé et DevTools n'est pas inclus dans dist/.
const DevTools = import.meta.env.DEV ? lazy(() => import('./DevTools')) : null;

/** Paramètres (SPEC §7.10) : Données, Préférences, Informations. */
export function SettingsPage() {
  // Export préparé dès l'ouverture de l'écran (partage immédiat au toucher).
  const preparedExport = usePreparedExport();
  const persistence = usePersistenceStatus();

  return (
    <Page title={t.title} backTo="/">
      <section className={styles.section} aria-labelledby="settings-data">
        <Eyebrow id="settings-data">{t.data}</Eyebrow>
        <Card className={styles.group}>
          <ExportSection state={preparedExport} />
        </Card>
        <Card className={styles.group}>
          <p className={styles.hint}>{strings.coachExport.entryHint}</p>
          <ButtonLink to="/settings/coach" variant="secondary" fullWidth icon={<Send aria-hidden />}>
            {strings.coachExport.entry}
          </ButtonLink>
        </Card>
        <Card className={styles.group}>
          <RestoreFlow currentExport={preparedExport} />
        </Card>
        <Card className={styles.group}>
          <p className={styles.hint}>{t.importProgramHint}</p>
          <ImportProgramButton label={t.importProgram} variant="secondary" />
          <ImportPasteButton />
        </Card>
      </section>

      <section className={styles.section} aria-labelledby="settings-preferences">
        <Eyebrow id="settings-preferences">{t.preferences}</Eyebrow>
        <Card className={styles.group}>
          <dl className={styles.list}>
            <div className={styles.row}>
              <dt>{t.unit}</dt>
              <dd>{t.unitValue}</dd>
            </div>
            <div className={styles.row}>
              <dt>{t.theme}</dt>
              <dd>{t.themeValue}</dd>
            </div>
          </dl>
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
            <div className={styles.row}>
              <dt>{t.build}</dt>
              <dd>{APP_BUILD}</dd>
            </div>
            <div className={styles.row}>
              <dt>{t.storage}</dt>
              <dd>{persistence === undefined ? '…' : t.storageStatus[persistence]}</dd>
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
