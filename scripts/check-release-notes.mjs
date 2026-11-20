import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)
const root = path.resolve(import.meta.dirname, '..')
const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
const releases = require(path.join(root, 'cloudfunctions', 'api', 'releases.cjs'))

function versionParts(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version)
  if (!match) return null
  return match.slice(1).map(Number)
}

function compareVersions(left, right) {
  const leftParts = versionParts(left)
  const rightParts = versionParts(right)
  if (!leftParts || !rightParts) return 0
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return leftParts[index] - rightParts[index]
    }
  }
  return 0
}

if (!Array.isArray(releases) || releases.length === 0) {
  throw new Error('Release notes are missing')
}

const versions = new Set()
for (let index = 0; index < releases.length; index += 1) {
  const release = releases[index]
  if (!versionParts(release?.version)) {
    throw new Error(`Invalid release version at index ${index}`)
  }
  if (versions.has(release.version)) {
    throw new Error(`Duplicate release version: ${release.version}`)
  }
  versions.add(release.version)
  if (!Array.isArray(release.items) || release.items.length === 0) {
    throw new Error(`Release ${release.version} has no user-facing summary`)
  }
  if (release.items.some((item) => !String(item).trim())) {
    throw new Error(`Release ${release.version} contains an empty summary item`)
  }
  if (index > 0 && compareVersions(release.version, releases[index - 1].version) <= 0) {
    throw new Error('Release versions must be strictly increasing')
  }
}

const latestRelease = releases.at(-1).version
if (latestRelease !== packageJson.version) {
  throw new Error(
    `package.json version ${packageJson.version} does not match latest release ${latestRelease}`,
  )
}

console.log(`Release notes verified for ${latestRelease}.`)
