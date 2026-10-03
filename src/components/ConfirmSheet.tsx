import type { ReactNode } from 'react';
import { TriangleAlert } from 'lucide-react';
import { strings } from '../i18n/strings';
import { Button, type ButtonVariant } from './Button';
import { Sheet } from './Sheet';

interface ConfirmSheetProps {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  confirmVariant?: ButtonVariant;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /** Action supplémentaire facultative (ex. « Supprimer cette séance »). */
  extraAction?: { label: string; variant?: ButtonVariant; onClick: () => void };
}

/** Confirmation explicite d'une action (abandon, fin avec exercices non validés…). */
export function ConfirmSheet({
  title,
  children,
  confirmLabel,
  cancelLabel = strings.common.cancel,
  confirmVariant = 'primary',
  busy = false,
  onConfirm,
  onCancel,
  extraAction,
}: ConfirmSheetProps) {
  return (
    <Sheet
      title={title}
      tone={confirmVariant === 'danger' ? 'danger' : 'neutral'}
      icon={<TriangleAlert aria-hidden />}
      onClose={onCancel}
      dismissible={!busy}
      footer={
        <>
          <Button size="lg" fullWidth variant={confirmVariant} loading={busy} onClick={onConfirm}>
            {confirmLabel}
          </Button>
          {extraAction && (
            <Button variant={extraAction.variant ?? 'secondary'} fullWidth disabled={busy} onClick={extraAction.onClick}>
              {extraAction.label}
            </Button>
          )}
          <Button variant="ghost" fullWidth disabled={busy} onClick={onCancel}>
            {cancelLabel}
          </Button>
        </>
      }
    >
      {children}
    </Sheet>
  );
}
