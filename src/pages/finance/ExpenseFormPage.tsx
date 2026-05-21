import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { listProperties, sortHotelsFirst, type Property } from '@/lib/queries/properties';
import {
  createExpense,
  deleteExpense,
  getExpense,
  updateExpense,
  EXPENSE_CATEGORIES,
} from '@/lib/queries/expenses';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { DateInput } from '@/components/ui/DateInput';
import { Input } from '@/components/ui/Input';
import { NumberInput } from '@/components/ui/NumberInput';
import { Select } from '@/components/ui/Select';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { istanbulToday } from '@/lib/utils';

export function ExpenseFormPage() {
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);
  const navigate = useNavigate();

  const [properties, setProperties] = useState<Property[]>([]);

  const [propertyId, setPropertyId] = useState('');
  const [category, setCategory] = useState<string>(EXPENSE_CATEGORIES[0]);
  const [amount, setAmount] = useState(0);
  const [description, setDescription] = useState('');
  const [expenseDate, setExpenseDate] = useState(istanbulToday());
  const [isRecurring, setIsRecurring] = useState(false);
  // Whether the expense being edited posted a kasa movement — drives the
  // heads-up shown on the delete dialog.
  const [loadedPaidFromKasa, setLoadedPaidFromKasa] = useState(false);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const props = await listProperties();
        setProperties(props);
        if (!isEdit && props.length > 0 && !propertyId) {
          setPropertyId(props[0].id);
        }
        if (isEdit && id) {
          const e = await getExpense(id);
          if (!e) {
            setError('Gider bulunamadı');
            return;
          }
          setPropertyId(e.property_id ?? '');
          setCategory(e.category);
          setAmount(Number(e.amount));
          setDescription(e.description ?? '');
          setExpenseDate(e.expense_date);
          setIsRecurring(e.is_recurring);
          setLoadedPaidFromKasa(e.paid_from_kasa);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Yüklenemedi');
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, isEdit]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!category) {
      setError('Kategori seçilmelidir.');
      return;
    }
    if (amount < 0) {
      setError('Tutar negatif olamaz.');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expenseDate)) {
      setError('Geçerli bir tarih giriniz.');
      return;
    }

    setSaving(true);
    try {
      if (isEdit && id) {
        await updateExpense(id, {
          property_id: propertyId || null,
          category,
          amount,
          description: description.trim() || null,
          expense_date: expenseDate,
          is_recurring: isRecurring,
        });
      } else {
        await createExpense({
          propertyId: propertyId || null,
          category,
          amount,
          description: description.trim() || null,
          expenseDate,
          isRecurring,
          // A recurring expense (kira, fatura…) is paid out of the general kasa.
          paidFromKasa: isRecurring,
        });
      }
      navigate('/finance/expenses', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kaydedilemedi');
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!id) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteExpense(id);
      navigate('/finance/expenses', { replace: true });
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : 'Silme başarısız');
      setDeleting(false);
    }
  };

  if (loading) {
    return <p className="text-sm text-stone-600 dark:text-stone-300">Yükleniyor…</p>;
  }

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <Link
        to="/finance/expenses"
        className="inline-block text-sm text-emerald-600 hover:underline dark:text-emerald-500"
      >
        ← Giderler
      </Link>

      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold text-stone-900 dark:text-stone-100">
          {isEdit ? 'Gider Düzenle' : 'Yeni Gider'}
        </h1>
        {isEdit && (
          <Button
            variant="danger"
            size="sm"
            onClick={() => {
              setDeleteError(null);
              setConfirmDelete(true);
            }}
          >
            Sil
          </Button>
        )}
      </div>

      {properties.length === 0 && (
        <Card className="border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40">
          <p className="text-sm text-amber-700 dark:text-amber-400">
            Önce bir mülk eklemelisiniz.{' '}
            <Link to="/properties/new" className="underline">
              Mülk ekle
            </Link>
          </p>
        </Card>
      )}

      <Card>
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <Select
            label="Mülk"
            name="property"
            value={propertyId}
            onChange={setPropertyId}
            options={[
              { value: '', label: 'Genel — belirli bir mülk değil' },
              ...sortHotelsFirst(properties).map((p) => ({ value: p.id, label: p.name })),
            ]}
          />

          <Select
            label="Kategori"
            name="category"
            required
            value={category}
            onChange={setCategory}
            options={EXPENSE_CATEGORIES.map((c) => ({ value: c, label: c }))}
          />

          <NumberInput
            label="Tutar (₺)"
            name="amount"
            required
            min={0}
            step={10}
            value={amount}
            onChange={setAmount}
          />

          <DateInput
            label="Tarih"
            name="expense_date"
            required
            value={expenseDate}
            onChange={setExpenseDate}
          />

          <Input
            label="Açıklama"
            name="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={250}
          />

          <label className="flex items-center gap-2 text-sm text-stone-700 dark:text-stone-300">
            <input
              type="checkbox"
              checked={isRecurring}
              onChange={(e) => setIsRecurring(e.target.checked)}
              className="h-4 w-4 rounded border-stone-300 text-emerald-600 focus:ring-emerald-500"
            />
            Düzenli gider (örn. kira, fatura — her ay oluşturulur, kasadan düşülür)
          </label>

          {error && (
            <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-400">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Link to="/finance/expenses">
              <Button type="button" variant="secondary" disabled={saving}>
                İptal
              </Button>
            </Link>
            <Button type="submit" loading={saving}>
              {isEdit ? 'Kaydet' : 'Oluştur'}
            </Button>
          </div>
        </form>
      </Card>

      <ConfirmDialog
        open={confirmDelete}
        title="Gider silinsin mi?"
        description={
          <>
            <p>Gider Çöp Kutusu'na taşınır ve oradan geri yüklenebilir.</p>
            {loadedPaidFromKasa && (
              <p className="mt-2">
                <strong>Not:</strong> Bu giderin kasa hareketi otomatik
                silinmez — gerekirse Kasa sayfasından ayrıca kaldırın.
              </p>
            )}
          </>
        }
        confirmLabel="Sil"
        destructive
        loading={deleting}
        error={deleteError}
        onConfirm={handleDelete}
        onCancel={() => {
          setConfirmDelete(false);
          setDeleteError(null);
        }}
      />
    </div>
  );
}
