import { spawnSync } from 'node:child_process'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const baseArgument = process.argv.find((value) => value.startsWith('--base='))
const outArgument = process.argv.find((value) => value.startsWith('--out='))
const base = baseArgument?.slice('--base='.length) || '/'
const outDir =
  outArgument?.slice('--out='.length) || 'dist-demo'
const result = spawnSync(
  process.execPath,
  [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--config', 'vite.demo.config.ts'],
  {
    cwd: root,
    env: {
      ...process.env,
      VITE_CLOUDBASE_ENV_ID: 'demo',
      VITE_DORMSYNC_API_URL: '/demo-api',
      VITE_DEMO_BASE: base,
      VITE_DEMO_OUT_DIR: outDir,
    },
    stdio: 'inherit',
  },
)

process.exit(result.status || 0)
