import { spawnSync } from 'node:child_process'
import { access } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isPlaceholder, loadLocalEnvironment } from './local-env.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const target = process.argv.slice(2).find((value) => !value.startsWith('--'))
const dryRun = process.argv.includes('--dry-run')
const env = await loadLocalEnvironment(root)
const envId = env.CLOUDBASE_ENV_ID || env.VITE_CLOUDBASE_ENV_ID
const apiUrl = env.VITE_DORMSYNC_API_URL

if (!['api', 'web'].includes(target)) {
  throw new Error('Usage: node scripts/deploy-cloudbase.mjs <api|web>')
}
if (isPlaceholder(envId)) {
  throw new Error(
    'CloudBase environment ID is missing. Set CLOUDBASE_ENV_ID or VITE_CLOUDBASE_ENV_ID.',
  )
}
if (target === 'web' && (isPlaceholder(apiUrl) || !/^https:\/\//i.test(apiUrl))) {
  throw new Error(
    'VITE_DORMSYNC_API_URL is missing or invalid. Update .env.local and rebuild before deploying the website.',
  )
}

const cli = path.join(root, 'node_modules', '@cloudbase', 'cli', 'bin', 'tcb')
await access(cli)
let installDependency = false
try {
  await access(
    path.join(root, 'cloudfunctions', 'api', 'node_modules', '@cloudbase', 'node-sdk'),
  )
} catch {
  installDependency = true
}

const releaseCheck = spawnSync(
  process.execPath,
  [path.join(root, 'scripts', 'check-release-notes.mjs')],
  { cwd: root, stdio: 'inherit' },
)
if (releaseCheck.status !== 0) process.exit(releaseCheck.status || 1)

if (target === 'web') {
  await access(path.join(root, 'dist', 'index.html'))
}

const args =
  target === 'api'
    ? [
        'fn',
        'deploy',
        'dormsyncHttp',
        '--env-id',
        envId,
        '--force',
        '--yes',
        '--install-dependency',
        String(installDependency),
        '--json',
      ]
    : [
        'hosting',
        'deploy',
        './dist',
        '--env-id',
        envId,
        '--safe',
        '--verify',
        '--json',
      ]

if (dryRun) {
  console.log(
    JSON.stringify(
      {
        target,
        envId,
        command: [process.execPath, cli, ...args],
        dryRun: true,
      },
      null,
      2,
    ),
  )
  process.exit(0)
}

const result = spawnSync(process.execPath, [cli, ...args], {
  cwd: root,
  stdio: 'inherit',
})

if (result.status !== 0) process.exit(result.status || 1)
