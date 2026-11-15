import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Bring a Dish',
        short_name: 'Bring a Dish',
        description:
          'Sign up for a potluck, see who is coming and what they are bringing, and spot what the menu still needs.',
        theme_color: '#FFF8F0',
        background_color: '#FFF8F0',
        display: 'standalone',
        // Relative start_url/scope: works from any GitHub Pages subpath, matching base: './'.
        start_url: '.',
        scope: '.',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Precache the app shell, the dish catalog, and icons copied into dist/.
        globPatterns: ['**/*.{js,css,html,json,png,svg,ico,woff2}'],
        runtimeCaching: [
          {
            // Signup data must always be live: never cache Supabase API responses.
            urlPattern: /^https:\/\/[^/]+\.supabase\.co\/.*/i,
            handler: 'NetworkOnly',
          },
        ],
      },
    }),
  ],
  test: { environment: 'node', include: ['src/**/*.test.ts', 'src/**/*.test.tsx'] },
})
