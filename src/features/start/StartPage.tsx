import { Page } from '../../components/Page';
import { strings } from '../../i18n/strings';
import { StartGuide } from './StartGuide';

/** « Guide de démarrage » (Paramètres) : le même écran, accessible à tout moment (V1.8-SPEC §4.1). */
export function StartPage() {
  return (
    <Page title={strings.start.pageTitle} backTo="/settings" backLabel={strings.settings.title}>
      <StartGuide />
    </Page>
  );
}
