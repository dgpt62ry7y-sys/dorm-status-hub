import { readFile } from 'node:fs/promises'
import path from 'node:path'

export async function loadLocalEnvironment(root) {
  const values = {}
  try {
    const content = await readFile(path.join(root, '.env.local'), 'utf8')
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim()
      if (!line || line.startsWith('#')) continue
      const separator = line.indexOf('=')
      if (separator < 1) continue
      const key = line.slice(0, separator).trim()
      let value = line.slice(separator + 1).trim()
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }
      values[key] = value
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }

  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) values[key] = value
  }
  return values
}

export function isPlaceholder(value) {
  return (
    !value ||
    /your-env-id|your-api-domain|your-cloudbase|example/i.test(String(value))
  )
}
