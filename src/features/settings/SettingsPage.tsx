import { Card, Eyebrow } from '../../components/Card';
import { Page } from '../../components/Page';
import { APP_NAME, APP_VERSION } from '../../config';
import { strings } from '../../i18n/strings';
import { ImportProgramButton } from '../import/ImportProgramFlow';
import styles from './SettingsPage.module.css';

const t = strings.settings;

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
    </Page>
  );
}
