/// <reference lib="webworker" />
/*
 * HomeGuru PMS — Service Worker.
 *
 * Single SW file owned by us (vite-plugin-pwa's injectManifest strategy).
 * Combines:
 *   - Workbox precaching of build assets (replaces the old generateSW path)
 *   - Runtime caching for Supabase REST + Storage
 *   - SKIP_WAITING message handler so PwaUpdatePrompt can promote a new SW
 *   - Web Push + notificationclick handlers for the Phase 1 push system
 *
 * Why a hand-written SW instead of generateSW + importScripts: workbox's
 * generated SW wraps everything in an async define() callback, which means
 * importScripts() runs *after* the SW's synchronous parse — that violates
 * the spec assumption and surfaced as "Failed to execute 'importScripts'"
 * errors on install. Owning the file end to end avoids that whole class of
 * problem and keeps the push-event listener registered at the top level.
 */

import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { NetworkFirst, StaleWhileRevalidate } from 'workbox-strategies';

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: (string | { url: string; revision: string | null })[];
};

// vite-plugin-pwa replaces __WB_MANIFEST at build time with the precache list.
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// Runtime caching for Supabase — mirrors the old workbox.runtimeCaching config.
registerRoute(
  ({ url }) =>
    url.host.endsWith('supabase.co') && url.pathname.startsWith('/rest/'),
  new NetworkFirst({ cacheName: 'supabase-api', networkTimeoutSeconds: 5 }),
);
registerRoute(
  ({ url }) =>
    url.host.endsWith('supabase.co') && url.pathname.startsWith('/storage/'),
  new StaleWhileRevalidate({ cacheName: 'supabase-storage' }),
);

// SKIP_WAITING from the page — used by PwaUpdatePrompt to swap in a new SW
// once the operator taps "Yenile" on the update banner.
self.addEventListener('message', (event) => {
  const data = event.data as { type?: string } | undefined;
  if (data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// =============================================================================
// Web Push handlers (migration 050 + Phase 2 Edge Function).
// =============================================================================
// Payload shape from the Edge Function:
//   { title, body, url, tag?, icon? }
// Defensive parsing — a malformed payload still surfaces *something* so the
// operator knows the app pinged them.

interface PushPayload {
  title?: string;
  body?: string;
  url?: string;
  tag?: string;
  icon?: string;
}

/**
 * The app's base URL — "https://<user>.github.io/<repo>/" on GitHub Pages,
 * "http://localhost:5173/" in dev. `registration.scope` IS the deploy base:
 * the SW is served from `<base>sw.js` and takes its directory as scope.
 */
function appBase(): string {
  const scope = self.registration.scope;
  return scope.endsWith('/') ? scope : `${scope}/`;
}

/**
 * Absolute URL for a router-relative notification path (e.g. "/reservations/1").
 *
 * The DB triggers store paths WITHOUT the deploy base — correct for the page,
 * where React Router prepends `basename` itself. The SW has no router: handing
 * "/reservations/1" straight to openWindow() resolves it against the ORIGIN
 * ROOT, i.e. https://<user>.github.io/reservations/1 — GitHub's own 404 page,
 * since the app actually lives under /<repo>/. Resolving against the base keeps
 * that prefix. Leading slashes are stripped so the path resolves RELATIVE to
 * the base instead of replacing it.
 */
function toAppUrl(path: string): string {
  const base = appBase();
  try {
    return new URL(path.replace(/^\/+/, ''), base).href;
  } catch {
    return base;
  }
}

self.addEventListener('push', (event) => {
  let payload: PushPayload = {};
  if (event.data) {
    try {
      payload = event.data.json() as PushPayload;
    } catch {
      payload = { title: 'HomeGuru', body: event.data.text() };
    }
  }

  const title = payload.title || 'HomeGuru';
  const options: NotificationOptions = {
    body: payload.body || '',
    icon: payload.icon || 'icons/icon-512.png',
    badge: 'icons/icon-512.png',
    data: { url: payload.url || '/' },
    tag: payload.tag,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data as { url?: string } | undefined;
  // Router-relative path exactly as the triggers store it ("/reservations/123").
  // Anything else — absolute, or protocol-relative "//host" which would escape
  // the origin — falls back to the app root.
  const raw = data?.url;
  const path = raw && raw.startsWith('/') && !raw.startsWith('//') ? raw : '/';

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      // Keep only windows inside our own base: `includeUncontrolled` also
      // returns other same-origin apps (github.io serves every repo from one
      // origin), and focusing one of those drops the operator into a different
      // app that ignores the message below.
      const base = appBase();
      const appClients = allClients.filter((client) => client.url.startsWith(base));

      // Focus an existing HomeGuru tab and tell it where to go — much cheaper
      // than opening a duplicate window. The page's PushNavigate listener turns
      // this into a React Router navigation (it re-adds the basename itself).
      for (const client of appClients) {
        if ('focus' in client) {
          await client.focus();
          try {
            client.postMessage({ type: 'PUSH_NAVIGATE', url: path });
          } catch {
            /* postMessage failures shouldn't block focusing */
          }
          return;
        }
      }
      // No app window open — open one at the BASE-PREFIXED deep link.
      if (self.clients.openWindow) {
        await self.clients.openWindow(toAppUrl(path));
      }
    })(),
  );
});
