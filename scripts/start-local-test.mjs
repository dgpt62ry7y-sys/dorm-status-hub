import { spawn } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isPlaceholder, loadLocalEnvironment } from './local-env.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const env = await loadLocalEnvironment(root)
const creatorKey = env.DORMSYNC_CREATOR_KEY
const adminKey = env.DORMSYNC_ADMIN_KEY

if (isPlaceholder(creatorKey) || isPlaceholder(adminKey)) {
  throw new Error(
    'Set DORMSYNC_CREATOR_KEY and DORMSYNC_ADMIN_KEY in .env.local before starting the local test environment.',
  )
}

const apiPort = 8788
const webPort = 5175
const childEnv = {
  ...process.env,
  DORMSYNC_CREATOR_KEY: creatorKey,
  DORMSYNC_ADMIN_KEY: adminKey,
  DORMSYNC_BARK_ENCRYPTION_KEY: '0123456789abcdef'.repeat(4),
  DORMSYNC_LOCAL_TEST_MODE: 'true',
  VITE_CLOUDBASE_ENV_ID: 'local-test',
  VITE_DORMSYNC_API_URL: '/dormsyncApi',
  VITE_LOCAL_TEST_MODE: 'true',
  DORMSYNC_NTFY_SERVER: `http://127.0.0.1:${apiPort}/ntfy`,
  DORMSYNC_NTFY_PUBLIC_URL: 'https://ntfy.sh',
}

const api = spawn(
  process.execPath,
  [path.join(root, 'tests', 'support', 'local-api-server.cjs'), String(apiPort)],
  {
    cwd: root,
    env: childEnv,
    stdio: 'inherit',
    windowsHide: true,
  },
)

const web = spawn(
  process.execPath,
  [
    path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'),
    '--host',
    '0.0.0.0',
    '--port',
    String(webPort),
    '--strictPort',
  ],
  {
    cwd: root,
    env: childEnv,
    stdio: 'inherit',
    windowsHide: true,
  },
)

console.log(`Local test app: http://127.0.0.1:${webPort}/`)
console.log(`Local test API: http://127.0.0.1:${apiPort}/dormsyncApi`)
for (const address of Object.values(os.networkInterfaces())
  .flat()
  .filter((item) => item?.family === 'IPv4' && !item.internal)
  .map((item) => item.address)) {
  console.log(`Phone test app: http://${address}:${webPort}/`)
}

function shutdown() {
  api.kill()
  web.kill()
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
api.on('exit', (code) => {
  if (code && code !== 0) shutdown()
})
web.on('exit', (code) => {
  if (code && code !== 0) shutdown()
})
