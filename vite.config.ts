import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { APP_VERSION } from './version.config'

export default defineConfig({
  plugins: [vue()],
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },
  server: {
    proxy: {
      '/dormsyncApi': {
        target: 'http://127.0.0.1:8788',
        changeOrigin: true,
      },
    },
  },
})
