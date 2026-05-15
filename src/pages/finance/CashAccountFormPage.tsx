import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { listProperties, type Property } from '@/lib/queries/properties';
import {
  createCashAccount,
  getCashAccount,
  updateCashAccount,
} from '@/lib/queries/cashAccounts';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import type { AccountType } from '@/types/database';

const ACCOUNT_TYPE_OPTIONS: { value: AccountType; label: string }[] = [
  { value: 'CASH', label: 'Nakit' },
  { value: 'BANK', label: 'Banka' },
  { value: 'CARD', label: 'Kredi Kartı' },
];

export function CashAccountFormPage() {
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);
  const navigate = useNavigate();

  const [properties, setProperties] = useState<Property[]>([]);

  const [propertyId, setPropertyId] = useState('');
  const [name, setName] = useState('');
  const [accountType, setAccountType] = useState<AccountType>('CASH');
  const [currency, setCurrency] = useState('TRY');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const props = await listProperties();
        setProperties(props);
        if (!isEdit && props.length > 0 && !propertyId) {
          setPropertyId(props[0].id);
        }
        if (isEdit && id) {
          const a = await getCashAccount(id);
          if (!a) {
            setError('Kasa bulunamadı');
            return;
          }
          setPropertyId(a.property_id);
          setName(a.name);
          setAccountType(a.account_type);
          setCurrency(a.currency);
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
    if (!name.trim()) {
      setError('Kasa adı zorunludur.');
      return;
    }
    if (!propertyId) {
      setError('Mülk seçilmelidir.');
      return;
    }

    setSaving(true);
    try {
      if (isEdit && id) {
        await updateCashAccount(id, {
          property_id: propertyId,
          name: name.trim(),
          account_type: accountType,
          currency: currency.trim() || 'TRY',
        });
        navigate(`/finance/cash/${id}`, { replace: true });
      } else {
        const created = await createCashAccount({
          property_id: propertyId,
          name: name.trim(),
          account_type: accountType,
          currency: currency.trim() || 'TRY',
        });
        navigate(`/finance/cash/${created.id}`, { replace: true });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kaydedilemedi');
      setSaving(false);
    }
  };

  if (loading) {
    return <p className="text-sm text-stone-600 dark:text-stone-300">Yükleniyor…</p>;
  }

  const backTo = isEdit && id ? `/finance/cash/${id}` : '/finance/cash';

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <Link
        to={backTo}
        className="inline-block text-sm text-emerald-600 hover:underline dark:text-emerald-500"
      >
        ← Geri
      </Link>
      <h1 className="text-2xl font-semibold text-stone-900 dark:text-stone-100">
        {isEdit ? 'Kasa Düzenle' : 'Yeni Kasa'}
      </h1>

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
            required
            value={propertyId}
            onChange={setPropertyId}
            options={properties.map((p) => ({ value: p.id, label: p.name }))}
            placeholder="Mülk seçin"
          />

          <Input
            label="Kasa Adı"
            name="name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Örn: Ana Kasa, Garanti Hesabı"
            maxLength={80}
          />

          <Select
            label="Hesap Tipi"
            name="account_type"
            required
            value={accountType}
            onChange={(v) => setAccountType(v as AccountType)}
            options={ACCOUNT_TYPE_OPTIONS}
          />

          <Input
            label="Para Birimi"
            name="currency"
            value={currency}
            // ISO currency codes are 3 letters — strip anything else
            onChange={(e) =>
              setCurrency(
                e.target.value
                  .replace(/[^A-Za-z]/g, '')
                  .toUpperCase()
                  .slice(0, 3),
              )
            }
            placeholder="TRY"
            maxLength={3}
          />

          {error && (
            <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-400">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Link to={backTo}>
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
    </div>
  );
}
