import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * Handles the PUSH_NAVIGATE message the service worker posts when a push
 * notification is tapped while the app is already open (see the
 * notificationclick handler in src/sw.ts). The SW focuses the existing window
 * and sends the target path; without a listener the tap merely focused the app
 * and left the operator on whatever screen they were already on.
 *
 * The path arrives WITHOUT the deploy base (e.g. "/reservations/123"), matching
 * what the DB triggers store — React Router prepends `basename` itself, so it
 * must not be added here.
 */
export function PushNavigate() {
  const navigate = useNavigate();

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; url?: string } | undefined;
      if (data?.type !== 'PUSH_NAVIGATE' || !data.url) return;
      // Same-app paths only — mirrors the guard on the in-app list
      // (NotificationsPage). "//host" would navigate off-origin.
      if (!data.url.startsWith('/') || data.url.startsWith('//')) return;
      navigate(data.url);
    };

    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [navigate]);

  return null;
}
