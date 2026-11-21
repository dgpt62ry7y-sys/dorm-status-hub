import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { APP_VERSION } from './version.config'

export default defineConfig({
  plugins: [
    vue(),
    {
      name: 'dormsync-version-file',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'version.json',
          source: `${JSON.stringify({ version: APP_VERSION })}\n`,
        })
      },
    },
  ],
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
    __DEMO_MODE__: 'false',
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
