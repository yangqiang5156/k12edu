import { loadEnv } from 'vite';
import { createLocalServices } from './server/local-services.mjs';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [
    react(),
    {
      name: 'online-services',
      configureServer(server) {
        const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
        server.middlewares.use(createLocalServices(env));
      },
      configurePreviewServer(server) {
        const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
        server.middlewares.use(createLocalServices(env));
      },
    },
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: '乐学',
        short_name: '乐学',
        description: '为4岁孩子设计的轻量早教学习与成长工作台',
        theme_color: '#6f5bd3',
        background_color: '#fff9f1',
        display: 'standalone',
        orientation: 'portrait-primary',
        start_url: './',
        scope: './',
        lang: 'zh-CN',
        categories: ['education', 'kids'],
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/\/api\//],
        cleanupOutdatedCaches: true,
        skipWaiting: true,
        clientsClaim: true,
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}']
      }
    })
  ]
}));
