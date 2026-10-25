import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// base './' so the built dist/ also works opened straight from disk.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Counterweight',
        short_name: 'Counterweight',
        description: 'Options analytics and liquidation heatmap for BTC, ETH and gold',
        theme_color: '#0d0d0d',
        background_color: '#0d0d0d',
        display: 'standalone',
        start_url: './',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
      workbox: {
        // cache the app shell only; market data must always come from the network
        globPatterns: ['**/*.{js,css,html,svg,webmanifest}'],
        navigateFallback: 'index.html',
        runtimeCaching: [],
      },
    }),
  ],
  base: './',
  server: {
    port: 5180,
    proxy: {
      // OKX's statistics endpoints reject browser cross-origin calls; in dev Vite relays them,
      // in production api/okx-relay.ts does, behind a rewrite (same path).
      '/api/okx': {
        target: 'https://www.okx.com/api/v5',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/okx/, ''),
      },
    },
  },
});
