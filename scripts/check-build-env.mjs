import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isPlaceholder, loadLocalEnvironment } from './local-env.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const env = await loadLocalEnvironment(root)
const envId = env.VITE_CLOUDBASE_ENV_ID
const apiUrl = env.VITE_DORMSYNC_API_URL

if (isPlaceholder(envId)) {
  throw new Error(
    'Missing VITE_CLOUDBASE_ENV_ID. Create .env.local and set your own CloudBase environment ID.',
  )
}
if (isPlaceholder(apiUrl) || !/^https:\/\//i.test(apiUrl)) {
  throw new Error(
    'Missing or invalid VITE_DORMSYNC_API_URL. Set your own HTTPS CloudBase HTTP API URL in .env.local.',
  )
}

console.log(`Build environment verified for ${envId}.`)
