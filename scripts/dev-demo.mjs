import { spawn } from 'node:child_process'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const child = spawn(
  process.execPath,
  [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--config', 'vite.demo.config.ts'],
  {
    cwd: root,
    env: {
      ...process.env,
      VITE_CLOUDBASE_ENV_ID: 'demo',
      VITE_DORMSYNC_API_URL: '/demo-api',
    },
    stdio: 'inherit',
  },
)

console.log('Demo app: http://127.0.0.1:5177/')
child.on('exit', (code) => process.exit(code || 0))
