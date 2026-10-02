import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Database, TriangleAlert } from 'lucide-react';
import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { ErrorDetails } from '../components/ErrorDetails';
import { strings } from '../i18n/strings';
import { technicalDetails } from '../utils/errors';
import styles from './ErrorBoundary.module.css';

/** Erreurs (Dexie / IndexedDB) signalant une base locale inutilisable. */
const DB_ERROR_NAMES = new Set(['OpenFailedError', 'DatabaseClosedError', 'MissingAPIError', 'InvalidStateError', 'QuotaExceededError', 'UnknownError']);

/** Base indisponible, y compris quand Dexie emballe l'erreur d'origine (`inner`, `cause`). */
export function isDatabaseError(error: unknown, depth = 0): boolean {
  if (!(error instanceof Error) || depth > 3) return false;
  if (DB_ERROR_NAMES.has(error.name)) return true;
  const wrapped = (error as { inner?: unknown }).inner ?? error.cause;
  return isDatabaseError(wrapped, depth + 1);
}

interface State {
  error: unknown;
}

/**
 * Filet de sécurité global (SPEC §7.9) : jamais d'écran blanc. Message clair (base
 * indisponible ou erreur inattendue), détails techniques sur demande, rechargement.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error(error, info.componentStack);
  }

  override render(): ReactNode {
    if (this.state.error === null) return this.props.children;
    const database = isDatabaseError(this.state.error);
    return (
      <div className={styles.screen}>
        <EmptyState
          icon={database ? <Database /> : <TriangleAlert />}
          title={database ? strings.errors.dbTitle : strings.errors.title}
          text={database ? strings.errors.dbUnavailable : strings.errors.unexpected}
        >
          <Button
            fullWidth
            onClick={() => {
              window.location.reload();
            }}
          >
            {strings.errors.reload}
          </Button>
          <ErrorDetails details={technicalDetails(this.state.error)} />
        </EmptyState>
      </div>
    );
  }
}
