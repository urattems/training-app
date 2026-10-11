import { useState } from 'react';
import { BookOpen, ClipboardCopy } from 'lucide-react';
import { ExternalButtonLink } from '../../components/Button';
import { Card } from '../../components/Card';
import { CopyTextButton } from '../../components/CopyTextButton';
import { COACH_GUIDE_URL, COACH_PROMPT } from '../../coach/coachPrompt';
import { strings } from '../../i18n/strings';
import { ImportPasteButton, ImportProgramButton } from '../import/ImportProgramFlow';
import { detectPlatform, isInstalledApp, readStandaloneSignals, type Platform } from './platform';
import styles from './StartGuide.module.css';

const t = strings.start;

interface StartGuideProps {
  /** Accueil d'une app vide : « Bienvenue » en tête (premier lancement). */
  welcome?: boolean;
}

/**
 * Écran de démarrage (V1.8-SPEC §4.1) : Installer (masqué en mode installé), Démarrer ton coach,
 * Importer ton programme. Rien n'est enregistré : le choix iPhone / Android n'est pas mémorisé.
 */
export function StartGuide({ welcome = false }: StartGuideProps) {
  const [installed] = useState(() => isInstalledApp(readStandaloneSignals()));
  const [platform, setPlatform] = useState<Platform>(() => detectPlatform(navigator.userAgent));
  const step = (offset: number) => (installed ? offset - 1 : offset);

  return (
    <div className={styles.guide}>
      {welcome && (
        <Card aria-labelledby="start-welcome">
          <h2 id="start-welcome" className={styles.welcomeTitle}>
            {strings.home.welcomeTitle}
          </h2>
          <p className={styles.text}>{strings.home.welcomeText}</p>
          <p className={styles.muted}>{t.intro}</p>
        </Card>
      )}

      {!installed && (
        <Card aria-labelledby="start-install" className={styles.step}>
          <h2 id="start-install" className={styles.stepTitle}>
            {t.stepTitle(step(1), t.installTitle)}
          </h2>
          <p className={styles.text}>{t.installText}</p>
          <div role="group" aria-label={t.platformLabel} className={styles.platforms}>
            {(['iphone', 'android'] as const).map((p) => (
              <button
                key={p}
                type="button"
                className={styles.platform}
                aria-pressed={platform === p}
                onClick={() => {
                  setPlatform(p);
                }}
              >
                {t[p]}
              </button>
            ))}
          </div>
          <ol className={styles.steps} aria-label={t[platform]}>
            {(platform === 'iphone' ? t.iphoneSteps : t.androidSteps).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ol>
        </Card>
      )}

      <Card aria-labelledby="start-coach" className={styles.step}>
        <h2 id="start-coach" className={styles.stepTitle}>
          {t.stepTitle(step(2), t.coachTitle)}
        </h2>
        <p className={styles.text}>{t.coachText}</p>
        <CopyTextButton text={COACH_PROMPT} label={t.copyPrompt} icon={<ClipboardCopy aria-hidden />} size="lg" />
        <ExternalButtonLink href={COACH_GUIDE_URL} fullWidth icon={<BookOpen aria-hidden />}>
          {t.openGuide}
        </ExternalButtonLink>
        <p className={styles.muted}>{t.openGuideHint}</p>
        <p className={styles.privacy}>{t.privacy}</p>
      </Card>

      <Card aria-labelledby="start-import" className={styles.step}>
        <h2 id="start-import" className={styles.stepTitle}>
          {t.stepTitle(step(3), t.importTitle)}
        </h2>
        <p className={styles.text}>{t.importText}</p>
        <ImportPasteButton variant="primary" />
        <ImportProgramButton variant="secondary" />
      </Card>
    </div>
  );
}
