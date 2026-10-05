import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// base: './' so the site works on any GitHub Pages path (user.github.io/<repo>/) and custom domains.
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 900 },
})
