import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    // Same-origin API in development, like CloudFront in the cloud (cookies just work).
    proxy: { '/api': 'http://localhost:3001' },
  },
})
