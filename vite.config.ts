import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';

// `base` must match `/<repo-name>/` when deployed to GitHub Pages.
// CI sets VITE_BASE; locally falls back to '/' so `npm run dev` works.
const base = process.env.VITE_BASE ?? '/';

export default defineConfig({
  base,
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'icons/apple-touch-180.png'],
      manifest: {
        name: 'HomeGuru PMS',
        short_name: 'HomeGuru',
        description: 'Property management for HomeGuru',
        theme_color: '#1a73e8',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: base,
        scope: base,
        icons: [
          { src: 'icons/192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.host.endsWith('supabase.co') && url.pathname.startsWith('/rest/'),
            handler: 'NetworkFirst',
            options: { cacheName: 'supabase-api', networkTimeoutSeconds: 5 },
          },
          {
            urlPattern: ({ url }) => url.host.endsWith('supabase.co') && url.pathname.startsWith('/storage/'),
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'supabase-storage' },
          },
        ],
      },
    }),
  ],
});
