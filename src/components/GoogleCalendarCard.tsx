import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import {
  buildGoogleOAuthUrl,
  disconnectGoogleCalendar,
  getGoogleConnection,
  type GoogleConnection,
} from '@/lib/queries/google_calendar';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { formatDate } from '@/lib/utils';

type Status = 'checking' | 'connected' | 'disconnected';

/**
 * Profile-page card for connecting/disconnecting Google Calendar. SUPER_ADMIN
 * only — the OAuth flow runs in the same browser tab, lands at the callback
 * Edge Function which redirects back to this page with ?google_connected=1
 * or ?google_error=... so we can render a banner without polling.
 */
export function GoogleCalendarCard() {
  const { user, profile } = useAuth();
  const [status, setStatus] = useState<Status>('checking');
  const [connection, setConnection] = useState<GoogleConnection | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ kind: 'success' | 'error'; text: string } | null>(
    null,
  );

  // SUPER_ADMIN only. Hide entirely for everyone else.
  const isAdmin = profile?.role === 'SUPER_ADMIN';

  useEffect(() => {
    if (!isAdmin) return;
    refresh();
  }, [isAdmin]);

  // Pick up the OAuth round-trip result from the URL.
  useEffect(() => {
    if (!isAdmin) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('google_connected') === '1') {
      setBanner({ kind: 'success', text: 'Google Takvim başarıyla bağlandı.' });
      // Strip the query so a reload doesn't re-fire the banner.
      window.history.replaceState({}, '', window.location.pathname + window.location.hash);
      refresh();
    }
    const err = params.get('google_error');
    if (err) {
      setBanner({ kind: 'error', text: `Google bağlantısı başarısız: ${err}` });
      window.history.replaceState({}, '', window.location.pathname + window.location.hash);
    }
  }, [isAdmin]);

  const refresh = async () => {
    try {
      const c = await getGoogleConnection();
      setConnection(c);
      setStatus(c ? 'connected' : 'disconnected');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Bağlantı durumu alınamadı.');
      setStatus('disconnected');
    }
  };

  const handleConnect = () => {
    if (!user) return;
    setError(null);
    try {
      window.location.href = buildGoogleOAuthUrl(user.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Bağlantı başlatılamadı.');
    }
  };

  const handleDisconnect = async () => {
    setBusy(true);
    setError(null);
    try {
      await disconnectGoogleCalendar();
      setBanner({
        kind: 'success',
        text: 'Bağlantı kaldırıldı. Google tarafındaki izni iptal etmek için myaccount.google.com/permissions adresini ziyaret edin.',
      });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Bağlantı kaldırılamadı.');
    } finally {
      setBusy(false);
    }
  };

  if (!isAdmin) return null;

  return (
    <Card>
      <h2 className="text-lg font-semibold text-stone-900 dark:text-stone-100">
        Google Takvim Entegrasyonu
      </h2>
      <p className="mt-1 text-sm text-stone-600 dark:text-stone-300">
        Rezervasyonlarınız bağlı Google Takvim'e otomatik yazılır. Takvime
        dışarıdan (örn. Meta AI) eklenen etkinlikler "Beklemede - Google"
        kuyruğuna düşer ve daireyi siz atarsınız.
      </p>

      {banner && (
        <p
          className={`mt-3 rounded px-3 py-2 text-sm ${
            banner.kind === 'success'
              ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
              : 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400'
          }`}
        >
          {banner.text}
        </p>
      )}
      {error && (
        <p className="mt-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-400">
          {error}
        </p>
      )}

      <div className="mt-4">
        {status === 'checking' && (
          <p className="text-sm text-stone-500 dark:text-stone-400">Kontrol ediliyor…</p>
        )}

        {status === 'disconnected' && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-stone-700 dark:text-stone-300">
              Google Takvim <strong>bağlı değil</strong>.
            </p>
            <Button onClick={handleConnect}>Google Takvim'i Bağla</Button>
          </div>
        )}

        {status === 'connected' && connection && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-stone-700 dark:text-stone-300">
              <p>
                <strong className="text-emerald-700 dark:text-emerald-400">Bağlı</strong>
                {' · '}
                Takvim: <code className="text-xs">{connection.calendar_id}</code>
              </p>
              <p className="mt-0.5 text-xs text-stone-500 dark:text-stone-400">
                {formatDate(connection.connected_at)} tarihinden beri bağlı.
              </p>
            </div>
            <Button variant="secondary" onClick={handleDisconnect} loading={busy}>
              Bağlantıyı Kaldır
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
