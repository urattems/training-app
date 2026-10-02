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
