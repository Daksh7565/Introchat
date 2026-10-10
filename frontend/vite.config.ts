import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig } from 'vitest/config'

// Theme colour is shared by the web manifest, the browser UI bar and the
// splash screen of the installed app.
const THEME_COLOR = '#0f766e'
const BACKGROUND_COLOR = '#ffffff'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // injectManifest (not generateSW): we write our own service worker
      // because M4 adds Web Push handlers, which generateSW cannot express.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      // 'prompt', never 'autoUpdate': an automatic reload would wipe a guest's
      // half-typed message mid-chat. The app asks first (UpdatePrompt).
      registerType: 'prompt',
      // Registration happens in UpdatePrompt via virtual:pwa-register/react.
      injectRegister: false,
      manifest: {
        name: 'IntroChat',
        short_name: 'IntroChat',
        description: 'Meet the people around you, anonymously.',
        lang: 'en',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: THEME_COLOR,
        background_color: BACKGROUND_COLOR,
      },
      // Icons are generated at build time from one SVG, so no binary icon
      // files live in git. Replace public/app-icon.svg when the final name
      // and logo are decided; every size regenerates from it.
      pwaAssets: {
        image: 'public/app-icon.svg',
        preset: 'minimal-2023',
        overrideManifestIcons: true,
      },
      devOptions: {
        // The service worker stays off in `npm run dev` so a cached shell
        // never hides a code change while developing. Test it with
        // `npm run build && npm run preview`.
        enabled: false,
      },
    }),
  ],
  test: {
    // 'threads', not the default 'forks': on the Windows dev machine the forks
    // pool timed out starting its workers ("Timeout waiting for worker to
    // respond") and ran no tests at all. Threads start reliably and CI runs
    // the same config.
    pool: 'threads',
    environment: 'jsdom',
    setupFiles: ['src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
