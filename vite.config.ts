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
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'HomeGuru PMS',
        short_name: 'HomeGuru',
        description: 'Property management for HomeGuru',
        theme_color: '#059669',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: base,
        scope: base,
        // Using the SVG favicon as the PWA icon — works for all sizes.
        // Replace with proper PNG icons (192/512/maskable) before going to production.
        icons: [
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
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
