import { useEffect, useRef, type ReactNode } from 'react';
import { Button } from '@/components/ui/Button';

interface Props {
  open: boolean;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
}

/**
 * Accessible confirmation dialog built on the native <dialog> element.
 * Uses showModal() so it traps focus and closes on Escape automatically.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Onayla',
  cancelLabel = 'İptal',
  destructive = false,
  onConfirm,
  onCancel,
  loading,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dlg = ref.current;
    if (!dlg) return;
    if (open && !dlg.open) dlg.showModal();
    if (!open && dlg.open) dlg.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      className="rounded-lg bg-white p-0 shadow-xl backdrop:bg-black/50 dark:bg-stone-900"
    >
      <div className="w-full max-w-sm p-6">
        <h2 className="text-lg font-semibold text-stone-900 dark:text-stone-100">{title}</h2>
        {description && (
          <div className="mt-2 text-sm text-stone-700 dark:text-stone-400">{description}</div>
        )}
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button
            variant={destructive ? 'danger' : 'primary'}
            onClick={onConfirm}
            loading={loading}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
