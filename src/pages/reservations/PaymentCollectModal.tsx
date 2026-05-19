import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { collectPayment } from '@/lib/queries/payments';
import { listCashAccounts, type CashAccountWithProperty } from '@/lib/queries/cashAccounts';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { NumberInput } from '@/components/ui/NumberInput';
import { Select } from '@/components/ui/Select';
import { cn } from '@/lib/utils';
import type { PaymentMethod } from '@/types/database';

interface Props {
  reservationId: string;
  propertyId: string;
  /** If true, fetch + show the cash-account dropdown when method=CASH. RECEPTION/HOUSEKEEPING get the auto-pick path. */
  canSeeCashAccounts: boolean;
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
  propertyId,
  canSeeCashAccounts,
  onClose,
  onCollected,
}: Props) {
  const { profile } = useAuth();
  // Roles without finance:write submit UNCONFIRMED rows that a manager later
  // approves before money lands in the kasa / cari. HOUSEKEEPING (Phase 3C-lite)
  // and YETKILI (migration 028) both fall in this bucket.
  const requiresApproval =
    profile?.role === 'HOUSEKEEPING' || profile?.role === 'YETKILI';

  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [amount, setAmount] = useState(0);
  const [note, setNote] = useState('');
  const [cashAccountId, setCashAccountId] = useState('');
  const [cashAccounts, setCashAccounts] = useState<CashAccountWithProperty[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amountRef = useRef<HTMLInputElement>(null);

  // Focus the amount field on mount; Escape closes
  useEffect(() => {
    amountRef.current?.focus();
    const handle = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handle);
    return () => document.removeEventListener('keydown', handle);
  }, [onClose]);

  // Load cash accounts when the user is allowed to see them.
  // For RECEPTION/HOUSEKEEPING this skips entirely; the RPC auto-picks server-side.
  useEffect(() => {
    if (!canSeeCashAccounts) return;
    listCashAccounts()
      .then((all) => {
        const forProperty = all.filter((a) => a.property_id === propertyId);
        setCashAccounts(forProperty);
        // Prefer a CASH-type account as default
        const defaultPick =
          forProperty.find((a) => a.account_type === 'CASH') ?? forProperty[0];
        if (defaultPick) setCashAccountId(defaultPick.id);
      })
      .catch(() => {
        // Non-fatal: dropdown stays empty, server-side auto-pick will run
      });
  }, [canSeeCashAccounts, propertyId]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!amount || amount <= 0) {
      setError('Tutar sıfırdan büyük olmalıdır.');
      return;
    }
    if (method === 'CASH' && canSeeCashAccounts && !cashAccountId) {
      setError('Nakit ödeme için kasa seçilmelidir.');
      return;
    }

    setSaving(true);
    try {
      await collectPayment({
        reservationId,
        amount,
        method,
        cashAccountId: method === 'CASH' ? cashAccountId || null : null,
        note: note.trim() || null,
      });
      onCollected();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kaydedilemedi');
      setSaving(false);
    }
  };

  const showCashAccountSelect =
    method === 'CASH' && canSeeCashAccounts && cashAccounts.length > 0;

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

        {requiresApproval && (
          <div className="mb-4 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
            Bu tahsilat yönetici onayı bekleyecek. Kasa ve cari hesaba ancak
            yönetici onayladıktan sonra işlenir.
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

          {showCashAccountSelect && (
            <Select
              label="Kasa"
              name="cash_account"
              required
              value={cashAccountId}
              onChange={setCashAccountId}
              options={cashAccounts.map((a) => ({
                value: a.id,
                label: a.name,
              }))}
              placeholder="Kasa seçin"
            />
          )}

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
    </div>
  );
}
