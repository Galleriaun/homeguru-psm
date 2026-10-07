import { useEffect, useRef, useState, type FormEvent } from 'react';
import { collectPayment } from '@/lib/queries/payments';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { NumberInput } from '@/components/ui/NumberInput';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { cn, formatTRY } from '@/lib/utils';
import type { PaymentMethod } from '@/types/database';

interface Props {
  reservationId: string;
  /** Amount to pre-fill — typically the reservation's total. The operator
      can still overwrite (partial collection, refund-style entry, etc.). */
  defaultAmount?: number;
  /** Show the note that the payment waits in Onaylar until approved. Off for
      the roles that are not told about approval — see paymentCollectUi(). */
  showApprovalNotice?: boolean;
  /** Ask "Tahsilat yapılsın mı?" before the payment is sent. */
  confirmFirst?: boolean;
  onClose: () => void;
  onCollected: () => void;
}

const METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: 'Nakit',
  TRANSFER: 'Havale / EFT',
  CARD: 'Kart',
};

export function PaymentCollectModal({
  reservationId,
  defaultAmount = 0,
  showApprovalNotice = true,
  confirmFirst = false,
  onClose,
  onCollected,
}: Props) {
  // Migration 067: every tahsilat — including yönetici's own — lands as
  // UNCONFIRMED and waits for an explicit Onayla tap on /finance/pending.
  // Whether THIS user is told so is the caller's decision (showApprovalNotice).

  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [amount, setAmount] = useState(defaultAmount);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The "Tahsilat yapılsın mı?" question is on screen. */
  const [confirming, setConfirming] = useState(false);

  const amountRef = useRef<HTMLInputElement>(null);
  // Read by the Escape handler below, which is bound once.
  const confirmingRef = useRef(false);
  confirmingRef.current = confirming;
  // A second tap must never send a second payment, whatever the render timing.
  const sendingRef = useRef(false);

  // Focus the amount field on mount; Escape closes
  useEffect(() => {
    amountRef.current?.focus();
    const handle = (e: KeyboardEvent) => {
      // While the question is open, Escape belongs to it (the native dialog
      // cancels itself): it must not also close the whole Ödeme Topla form.
      if (e.key === 'Escape' && !confirmingRef.current) onClose();
    };
    document.addEventListener('keydown', handle);
    return () => document.removeEventListener('keydown', handle);
  }, [onClose]);

  const send = async () => {
    if (sendingRef.current) return;
    sendingRef.current = true;
    setSaving(true);
    try {
      // Cash payments land in the single general kasa — resolved server-side.
      await collectPayment({
        reservationId,
        amount,
        method,
        note: note.trim() || null,
      });
      onCollected();
    } catch (err) {
      // Back to the form with the reason; nothing was recorded.
      setError(err instanceof Error ? err.message : 'Kaydedilemedi');
      setSaving(false);
      setConfirming(false);
      sendingRef.current = false;
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!amount || amount <= 0) {
      setError('Tutar sıfırdan büyük olmalıdır.');
      return;
    }

    if (confirmFirst) {
      // Nothing is sent yet — only "Evet" in the question sends.
      setConfirming(true);
      return;
    }
    void send();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 pt-16"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <Card className="w-full max-w-md">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-stone-900 dark:text-stone-100">
            Ödeme Topla
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-700"
            aria-label="Kapat"
          >
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path
                d="M5 5l10 10M15 5L5 15"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        {showApprovalNotice && (
          <div className="mb-4 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
            Bu tahsilat <strong>Onaylar</strong> bölümünde onaylamanız için
            beklemede kalacak. Onaylanana kadar kasa ve cari hesaba işlenmez.
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div>
            <label className="block text-sm font-medium text-stone-700 dark:text-stone-300">
              Yöntem<span className="ml-0.5 text-red-500">*</span>
            </label>
            <div className="mt-1 grid grid-cols-3 gap-2">
              {(['CASH', 'TRANSFER', 'CARD'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMethod(m)}
                  className={cn(
                    'rounded-md border px-3 py-2 text-sm font-medium transition-colors',
                    method === m
                      ? 'border-emerald-600 bg-emerald-50 text-emerald-700 dark:border-emerald-500 dark:bg-emerald-900/30 dark:text-emerald-300'
                      : 'border-stone-300 text-stone-700 hover:bg-stone-100 dark:border-stone-600 dark:text-stone-300 dark:hover:bg-stone-800',
                  )}
                >
                  {METHOD_LABELS[m]}
                </button>
              ))}
            </div>
          </div>

          <NumberInput
            ref={amountRef}
            label="Tutar (₺)"
            name="amount"
            required
            min={0}
            step={10}
            value={amount}
            onChange={setAmount}
          />

          <Input
            label="Açıklama"
            name="note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={250}
          />

          {error && (
            <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-400">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
              İptal
            </Button>
            <Button type="submit" loading={saving}>
              Kaydet
            </Button>
          </div>
        </form>
      </Card>

      {/* Native <dialog>: it sits in the top layer above this form and makes
          the form inert, so the amount and method being confirmed cannot change
          underneath it. */}
      <ConfirmDialog
        open={confirming}
        title="Tahsilat yapılsın mı?"
        description={`${formatTRY(amount)} · ${METHOD_LABELS[method]}`}
        confirmLabel="Evet"
        cancelLabel="Vazgeç"
        loading={saving}
        onConfirm={() => void send()}
        onCancel={() => {
          if (!saving) setConfirming(false);
        }}
      />
    </div>
  );
}
