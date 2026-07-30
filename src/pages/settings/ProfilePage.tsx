import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { can } from '@/lib/rbac';
import { updateOwnFullName } from '@/lib/queries/profile';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { PushNotificationsCard } from '@/components/PushNotificationsCard';
import { NotificationSettingsCard } from '@/components/NotificationSettingsCard';
import { GoogleCalendarCard } from '@/components/GoogleCalendarCard';
import { formatRole } from '@/lib/utils';

export function ProfilePage() {
  const { profile, user, refreshProfile, signOut } = useAuth();
  const navigate = useNavigate();

  const [fullName, setFullName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successAt, setSuccessAt] = useState<number | null>(null);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  // Seed the input once the profile arrives.
  useEffect(() => {
    if (profile) setFullName(profile.full_name);
  }, [profile]);

  // Auto-clear the success message after a couple seconds.
  useEffect(() => {
    if (successAt === null) return;
    const t = window.setTimeout(() => setSuccessAt(null), 2500);
    return () => window.clearTimeout(t);
  }, [successAt]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const trimmed = fullName.trim();
    if (!trimmed) {
      setError('Ad boş olamaz.');
      return;
    }
    if (profile && trimmed === profile.full_name) {
      // No-op — nothing to save.
      return;
    }
    setSaving(true);
    try {
      await updateOwnFullName(trimmed);
      await refreshProfile();
      setSuccessAt(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kaydedilemedi');
    } finally {
      setSaving(false);
    }
  };

  const handleSignOut = async () => {
    setSigningOut(true);
    await signOut();
    navigate('/login', { replace: true });
  };

  if (!profile) {
    return <p className="text-sm text-stone-600 dark:text-stone-300">Yükleniyor…</p>;
  }

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-stone-900 dark:text-stone-100">
          Profil
        </h1>
        <p className="mt-1 text-sm text-stone-600 dark:text-stone-300">
          Görünen adınızı düzenleyin. Rol ve maaş gibi alanlar süper admin tarafından
          yönetilir.
        </p>
      </div>

      <Card>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Ad Soyad"
            name="full_name"
            required
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            maxLength={120}
            autoComplete="name"
          />

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-stone-600 dark:text-stone-300">
                Rol
              </p>
              <p className="mt-1 text-sm text-stone-900 dark:text-stone-100">
                {formatRole(profile.role)}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-stone-600 dark:text-stone-300">
                E-posta
              </p>
              <p className="mt-1 break-all text-sm text-stone-900 dark:text-stone-100">
                {user?.email ?? '—'}
              </p>
            </div>
          </div>

          {error && (
            <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-400">
              {error}
            </p>
          )}

          {successAt !== null && (
            <p className="rounded bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
              Profil güncellendi ✓
            </p>
          )}

          <div className="flex justify-end">
            <Button type="submit" loading={saving}>
              Kaydet
            </Button>
          </div>
        </form>
      </Card>

      <Card className="space-y-6">
        <PushNotificationsCard bare />
        <div className="border-t border-stone-200 dark:border-stone-700" />
        <NotificationSettingsCard bare />
      </Card>

      {can(profile.role, 'finance:read') && (
        <Card>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-stone-900 dark:text-stone-100">
                WhatsApp Şablonları
              </h2>
              <p className="mt-1 text-sm text-stone-600 dark:text-stone-300">
                Misafirlere gönderilecek mesaj şablonlarını yönetin.
              </p>
            </div>
            <Link
              to="/settings/templates"
              className="shrink-0 rounded-md border border-stone-300 px-3 py-1.5 text-sm font-medium text-stone-700 transition-colors hover:bg-stone-100 dark:border-stone-600 dark:text-stone-200 dark:hover:bg-stone-800"
            >
              Aç
            </Link>
          </div>
        </Card>
      )}

      <GoogleCalendarCard />

      {/* Plain red text rather than a filled danger button — signing out is a
          routine action, not a destructive one, and a full-width red slab drew
          more attention than it deserves. w-full + py-2 keep the tap target the
          same size on mobile. */}
      <div className="pt-2">
        <button
          type="button"
          onClick={() => setConfirmSignOut(true)}
          className="w-full py-2 text-sm font-medium text-red-600 hover:underline dark:text-red-400"
        >
          Çıkış Yap
        </button>
      </div>

      <ConfirmDialog
        open={confirmSignOut}
        title="Çıkış yapılsın mı?"
        description="Oturumunuz kapatılacak ve giriş ekranına yönlendirileceksiniz."
        confirmLabel="Çıkış Yap"
        cancelLabel="Vazgeç"
        destructive
        loading={signingOut}
        onConfirm={handleSignOut}
        onCancel={() => setConfirmSignOut(false)}
      />
    </div>
  );
}
