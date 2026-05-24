import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useAuth } from '@/hooks/useAuth';
import {
  listActiveReservations,
  type ReservationWithRefs,
} from '@/lib/queries/reservations';
import { createIssue } from '@/lib/queries/housekeepingIssues';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Select } from '@/components/ui/Select';
import { formatDate } from '@/lib/utils';
import { XMarkIcon } from '@/components/icons/ActionIcons';

interface Props {
  onClose: () => void;
  /** Fires after a successful create so the Dashboard can refresh its counts. */
  onCreated?: () => void;
}

/**
 * Panel "Sorunlar" quick-action modal: lists units that currently have an
 * active reservation and lets housekeeping file a problem report against the
 * one they're cleaning. Skips photo upload on purpose — the full IssuesModal
 * on the Temizlik page is the place for that; this entry point is optimised
 * for a one-handed "I see a problem, log it" flow.
 *
 * Writes into housekeeping_issues via the same createIssue path the existing
 * IssuesModal uses, so RLS, audit, and the open-issue counter all stay in
 * sync without any extra plumbing.
 */
export function QuickIssueModal({ onClose, onCreated }: Props) {
  const { user } = useAuth();
  const [activeReservations, setActiveReservations] = useState<ReservationWithRefs[] | null>(
    null,
  );
  const [loadError, setLoadError] = useState<string | null>(null);

  const [reservationId, setReservationId] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoadError(null);
    listActiveReservations()
      .then((rows) => {
        setActiveReservations(rows);
        // Default-select the first active reservation so the form is one
        // textarea away from submittable.
        if (rows.length > 0) {
          setReservationId((prev) => prev || rows[0].id);
        }
      })
      .catch((e) => setLoadError(e?.message ?? 'Aktif konaklamalar yüklenemedi'));
  }, []);

  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handle);
    return () => document.removeEventListener('keydown', handle);
  }, [onClose]);

  /** Build "Birim — Misafir (Giriş→Çıkış)" labels for the dropdown options. */
  const options = useMemo(() => {
    if (!activeReservations) return [];
    return activeReservations.map((r) => {
      const unit = r.unit?.name ?? '—';
      const property = r.property?.name ?? '';
      const guest = r.guest?.full_name ?? 'Misafir';
      const dates = `${formatDate(r.stay_start)}→${formatDate(r.stay_end)}`;
      return {
        value: r.id,
        label: `${unit} (${property}) — ${guest} · ${dates}`,
      };
    });
  }, [activeReservations]);

  const selectedReservation = useMemo(
    () => activeReservations?.find((r) => r.id === reservationId) ?? null,
    [activeReservations, reservationId],
  );

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!selectedReservation) {
      setError('Aktif bir konaklama seçin.');
      return;
    }
    if (!description.trim()) {
      setError('Sorun açıklaması zorunludur.');
      return;
    }
    if (!user) {
      setError('Oturum bulunamadı.');
      return;
    }
    setSaving(true);
    try {
      await createIssue({
        property_id: selectedReservation.property_id,
        unit_id: selectedReservation.unit_id,
        description: description.trim(),
        photo_paths: [],
        reported_by: user.id,
      });
      onCreated?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kaydedilemedi');
      setSaving(false);
    }
  };

  const noActive = activeReservations !== null && activeReservations.length === 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 pt-16"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <Card className="w-full max-w-md">
        <div className="mb-4 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-stone-900 dark:text-stone-100">
              Sorun Bildir
            </h2>
            <p className="text-sm text-stone-600 dark:text-stone-300">
              Aktif konaklaması olan bir birim seçip sorunu kısaca yazın.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded p-1 text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-700"
            aria-label="Kapat"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        {loadError && (
          <p className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-400">
            {loadError}
          </p>
        )}

        {!loadError && activeReservations === null && (
          <p className="text-sm text-stone-600 dark:text-stone-300">Yükleniyor…</p>
        )}

        {noActive && (
          <p className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
            Şu anda aktif konaklaması olan birim yok.
          </p>
        )}

        {activeReservations !== null && activeReservations.length > 0 && (
          <form onSubmit={handleSubmit} className="space-y-3" noValidate>
            <Select
              label="Aktif Birim"
              name="active_reservation"
              required
              searchable
              value={reservationId}
              onChange={setReservationId}
              options={options}
              placeholder="Aktif birim seçin"
            />

            <div>
              <label
                htmlFor="quick_issue_desc"
                className="block text-sm font-medium text-stone-700 dark:text-stone-300"
              >
                Sorun Açıklaması<span className="ml-0.5 text-red-500">*</span>
              </label>
              <textarea
                id="quick_issue_desc"
                name="quick_issue_desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={500}
                rows={3}
                autoFocus
                placeholder="Örn: Klima çalışmıyor, duşta sızıntı var."
                className="mt-1 block w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 placeholder-stone-400 shadow-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100 dark:placeholder-stone-500"
              />
              <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
                Fotoğraf eklemek için Temizlik sayfasındaki birim kartından ilerleyin.
              </p>
            </div>

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
                Sorun Bildir
              </Button>
            </div>
          </form>
        )}
      </Card>
    </div>
  );
}
