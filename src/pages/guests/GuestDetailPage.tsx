import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { can } from '@/lib/rbac';
import {
  getGuestDecrypted,
  deleteGuest,
} from '@/lib/queries/guests';
import type { DecryptedGuest } from '@/types/database';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { SendWhatsAppModal } from '@/components/SendWhatsAppModal';

export function GuestDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { profile } = useAuth();
  const navigate = useNavigate();

  const [guest, setGuest] = useState<DecryptedGuest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showWhatsApp, setShowWhatsApp] = useState(false);

  useEffect(() => {
    if (!id) return;
    setError(null);
    getGuestDecrypted(id)
      .then((g) => {
        if (!g) {
          setError('Misafir bulunamadı');
          return;
        }
        setGuest(g);
      })
      .catch((e) => setError(e?.message ?? 'Yüklenemedi'));
  }, [id]);

  if (error) {
    return (
      <Card className="border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40">
        <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
        <Link
          to="/guests"
          className="mt-3 inline-block text-sm text-emerald-600 hover:underline dark:text-emerald-500"
        >
          ← Misafirlere dön
        </Link>
      </Card>
    );
  }

  if (!guest) {
    return <p className="text-sm text-stone-600 dark:text-stone-300">Yükleniyor…</p>;
  }

  const isAdmin = profile && can(profile.role, 'admin:*');
  const canEdit = profile && can(profile.role, 'guest:update');
  const canDelete = isAdmin;

  const handleDelete = async () => {
    if (!id) return;
    setBusy(true);
    setDeleteError(null);
    try {
      await deleteGuest(id);
      navigate('/guests', { replace: true });
    } catch (e) {
      // Keep the dialog open and surface the reason inside it — don't
      // replace the whole page with a load-error card.
      setDeleteError(e instanceof Error ? e.message : 'Silme başarısız');
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <Link
        to="/guests"
        className="inline-block text-sm text-emerald-600 hover:underline dark:text-emerald-500"
      >
        ← Misafirler
      </Link>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-stone-900 dark:text-stone-100">
            {guest.full_name}
          </h1>
          {guest.nationality && (
            <p className="mt-1 text-sm text-stone-600 dark:text-stone-300">{guest.nationality}</p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setShowWhatsApp(true)}
          >
            WhatsApp
          </Button>
          {canEdit && (
            <Link to={`/guests/${guest.id}/edit`}>
              <Button variant="secondary" size="sm">
                Düzenle
              </Button>
            </Link>
          )}
          {canDelete && (
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
      </div>

      <Card>
        <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
          <Field label="Telefon" value={guest.phone} />
          <Field label="E-posta" value={guest.email} />
          <Field label="TC Kimlik" value={guest.tc_kimlik} />
          <Field label="Pasaport" value={guest.passport} />
          <Field label="Adres" value={guest.address} className="sm:col-span-2" />
        </dl>
      </Card>

      <ConfirmDialog
        open={confirmDelete}
        title={`"${guest.full_name}" silinsin mi?`}
        description={
          <>
            <p>Bu işlem geri alınamaz.</p>
            <p className="mt-2 font-medium">
              Not: Rezervasyon kaydı bulunan misafirler silinemez.
            </p>
          </>
        }
        confirmLabel="Sil"
        destructive
        loading={busy}
        error={deleteError}
        onConfirm={handleDelete}
        onCancel={() => {
          setConfirmDelete(false);
          setDeleteError(null);
        }}
      />

      {showWhatsApp && (
        <SendWhatsAppModal
          recipientName={guest.full_name}
          recipientPhone={guest.phone}
          variables={{
            misafir_adi: guest.full_name,
          }}
          onClose={() => setShowWhatsApp(false)}
        />
      )}
    </div>
  );
}

interface FieldProps {
  label: string;
  value: string | null;
  className?: string;
}

function Field({ label, value, className }: FieldProps) {
  return (
    <div className={className}>
      <dt className="text-xs font-medium uppercase tracking-wide text-stone-600 dark:text-stone-300">
        {label}
      </dt>
      <dd className="mt-1 text-stone-900 dark:text-stone-100">{value || '—'}</dd>
    </div>
  );
}
