import { useId, useLayoutEffect, useRef, useState } from 'react';
import { Lightbulb } from 'lucide-react';
import { strings } from '../../i18n/strings';
import styles from './ExerciseTip.module.css';

const t = strings.exercise;

/**
 * Conseil d'exécution (champ `notes` de l'exercice du programme, V1.1a).
 * Encart discret, distinct d'OBJECTIF (pointillés) et de RÉALISÉ (champs pleins) ;
 * replié sur 3 lignes avec « Voir plus » si le texte dépasse, pour ne pas repousser
 * la saisie. `notes` à null ou vide : rien n'est affiché.
 */
export function ExerciseTip({ notes }: { notes: string | null | undefined }) {
  const text = notes?.trim() ?? '';
  if (text === '') return null;
  return <TipBox key={text} text={text} />;
}

function TipBox({ text }: { text: string }) {
  const textId = useId();
  const textRef = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);

  // Mesure du débordement à l'état replié (le texte change de largeur avec l'écran).
  useLayoutEffect(() => {
    const element = textRef.current;
    if (!element || expanded) return;
    const measure = () => {
      setOverflows(element.scrollHeight > element.clientHeight + 1);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [expanded]);

  return (
    <aside className={styles.tip} aria-label={t.tip}>
      <p className={styles.label}>
        <Lightbulb aria-hidden />
        {t.tip}
      </p>
      <p ref={textRef} id={textId} className={expanded ? styles.text : `${styles.text ?? ''} ${styles.clamped ?? ''}`}>
        {text}
      </p>
      {(overflows || expanded) && (
        <button
          type="button"
          className={styles.toggle}
          aria-expanded={expanded}
          aria-controls={textId}
          onClick={() => {
            setExpanded((v) => !v);
          }}
        >
          {expanded ? t.tipLess : t.tipMore}
        </button>
      )}
    </aside>
  );
}
