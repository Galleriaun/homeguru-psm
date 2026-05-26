import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  dismissPendingGoogleReservation,
  listPendingGoogleReservations,
  type PendingGoogleReservation,
} from '@/lib/queries/google_calendar';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';

/**
 * "Beklemede - Google" queue. External Google Calendar events (Meta AI or
 * any direct calendar entries) arrive here via the google-sync-pull cron.
 * The owner picks a unit/guest by clicking Ata, which jumps to the standard
 * reservation form pre-filled with the Google start/end + a hidden link
 * back to this pending row so the form can mark it imported on save.
 */
export function GooglePendingPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<PendingGoogleReservation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    listPendingGoogleReservations()
      .then(setItems)
      .catch((e) => setError(e instanceof Error ? e.message : 'Yüklenemedi'));
  }, []);

  const handleAssign = (it: PendingGoogleReservation) => {
    // Pass the pending id forward; the reservation form picks up start/end
    // from the pending row itself so the URL stays short.
    const checkin = it.start_at.slice(0, 10);
    navigate(`/reservations/new?google_pending=${it.id}&checkin=${checkin}`);
  };

  const handleDismiss = async (it: PendingGoogleReservation) => {
    setBusyId(it.id);
    setError(null);
    try {
      await dismissPendingGoogleReservation(it.id);
      setItems((prev) => prev?.filter((p) => p.id !== it.id) ?? prev);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Yoksayılamadı');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-stone-900 dark:text-stone-100">
          Beklemede - Google
        </h1>
        <p className="mt-1 text-sm text-stone-600 dark:text-stone-300">
          Google Takvim'e dışarıdan (Meta AI vb.) eklenen rezervasyon talepleri.
          Daire seçip "Ata" tuşuyla resmî rezervasyona çevirin.
        </p>
      </div>

      {error && (
        <Card className="border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40">
          <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
        </Card>
      )}

      {!items && !error && (
        <p className="text-sm text-stone-600 dark:text-stone-300">Yükleniyor…</p>
      )}

      {items && items.length === 0 && (
        <Card>
          <p className="text-center text-sm text-stone-600 dark:text-stone-300">
            Bekleyen Google rezervasyonu yok.
          </p>
        </Card>
      )}

      {items && items.length > 0 && (
        <div className="space-y-2">
          {items.map((it) => {
            const start = new Date(it.start_at);
            const end = new Date(it.end_at);
            const dateFmt = new Intl.DateTimeFormat('tr-TR', {
              timeZone: 'Europe/Istanbul',
              dateStyle: 'medium',
              timeStyle: 'short',
            });
            const busy = busyId === it.id;
            return (
              <div
                key={it.id}
                className="rounded-lg border border-stone-200 bg-white p-3 dark:border-stone-700 dark:bg-stone-900"
              >
                <p className="font-semibold text-stone-900 dark:text-stone-100">
                  {it.summary ?? 'Başlıksız'}
                </p>
                <p className="mt-0.5 text-xs text-stone-700 dark:text-stone-300">
                  {dateFmt.format(start)} → {dateFmt.format(end)}
                </p>
                {it.description && (
                  <p className="mt-2 whitespace-pre-wrap text-xs text-stone-600 dark:text-stone-300">
                    {it.description}
                  </p>
                )}
                <div className="mt-3 flex justify-end gap-2">
                  <Button size="sm" onClick={() => handleAssign(it)} disabled={busy}>
                    Ata
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => handleDismiss(it)}
                    loading={busy}
                  >
                    Yoksay
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
