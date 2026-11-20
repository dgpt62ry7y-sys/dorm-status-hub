import path from 'node:path'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { APP_VERSION } from './version.config'

const root = path.resolve(import.meta.dirname, 'demo')

export default defineConfig({
  root,
  base: process.env.VITE_DEMO_BASE || '/',
  publicDir: path.resolve(import.meta.dirname, 'public'),
  plugins: [vue()],
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
    __DEMO_MODE__: 'true',
  },
  server: {
    host: '0.0.0.0',
    port: 5177,
    strictPort: true,
    fs: {
      allow: [path.resolve(import.meta.dirname)],
    },
  },
  build: {
    outDir: path.resolve(
      import.meta.dirname,
      process.env.VITE_DEMO_OUT_DIR || 'dist-demo',
    ),
    emptyOutDir: true,
  },
})
