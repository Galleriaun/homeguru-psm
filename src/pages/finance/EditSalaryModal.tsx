import { useEffect, useRef, useState, type FormEvent } from 'react';
import { updateStaffSalary } from '@/lib/queries/staff';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { NumberInput } from '@/components/ui/NumberInput';

interface Props {
  staffUserId: string;
  staffName: string;
  currentSalary: number | null;
  onClose: () => void;
  onUpdated: (newSalary: number) => void;
}

export function EditSalaryModal({
  staffUserId,
  staffName,
  currentSalary,
  onClose,
  onUpdated,
}: Props) {
  const [salary, setSalary] = useState<number>(currentSalary ?? 0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const salaryRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    salaryRef.current?.focus();
    const handle = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handle);
    return () => document.removeEventListener('keydown', handle);
  }, [onClose]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (salary < 0) {
      setError('Maaş negatif olamaz.');
      return;
    }

    setSaving(true);
    try {
      await updateStaffSalary(staffUserId, salary);
      onUpdated(salary);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kaydedilemedi');
      setSaving(false);
    }
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
            Maaş Düzenle
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

        <p className="mb-4 text-sm text-stone-600 dark:text-stone-300">
          <strong className="text-stone-900 dark:text-stone-100">{staffName}</strong>{' '}
          için aylık maaşı belirleyin.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <NumberInput
            ref={salaryRef}
            label="Aylık Maaş (₺)"
            name="salary"
            required
            min={0}
            step={100}
            value={salary}
            onChange={setSalary}
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
