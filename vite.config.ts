import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  /**
   * Mobile testing:
   * - `host: true` makes the dev server reachable from your phone via LAN IP.
   * - `proxy` lets the UI call `/ask` without hardcoding a backend host/port.
   */
  server: {
    host: true,
    proxy: {
      '/ask': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/case-studies': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/healthz': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: true,
  },
})
