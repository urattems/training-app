import { Component, type ErrorInfo, type ReactNode } from 'react';
import { TriangleAlert } from 'lucide-react';
import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { strings } from '../i18n/strings';
import styles from './ErrorBoundary.module.css';

/** Erreurs Dexie signalant une base IndexedDB inutilisable. */
const DB_ERROR_NAMES = new Set(['OpenFailedError', 'DatabaseClosedError', 'MissingAPIError', 'InvalidStateError', 'QuotaExceededError']);

export const isDatabaseError = (error: unknown): boolean => error instanceof Error && DB_ERROR_NAMES.has(error.name);

interface State {
  error: unknown;
}

/** Filet de sécurité global (SPEC §7.9) : message clair, jamais d'écran blanc. */
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
    return (
      <div className={styles.screen}>
        <EmptyState
          icon={<TriangleAlert />}
          title={strings.errors.title}
          text={isDatabaseError(this.state.error) ? strings.errors.dbUnavailable : strings.errors.unexpected}
        >
          <Button
            fullWidth
            onClick={() => {
              window.location.reload();
            }}
          >
            {strings.errors.reload}
          </Button>
        </EmptyState>
      </div>
    );
  }
}
