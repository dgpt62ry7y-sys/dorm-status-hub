const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const releases = JSON.parse(
  fs.readFileSync(path.join(root, 'cloudfunctions', 'api', 'releases.json'), 'utf8'),
)
const legacySource = fs.readFileSync(
  path.join(root, 'cloudfunctions', 'api', 'releases.cjs'),
  'utf8',
)
const frontendSource = fs.readFileSync(
  path.join(root, 'src', 'data', 'releases.ts'),
  'utf8',
)
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const versionSource = fs.readFileSync(path.join(root, 'version.config.ts'), 'utf8')
const appVersion = /APP_VERSION\s*=\s*['"]([^'"]+)['"]/.exec(versionSource)?.[1]

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function versionParts(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version)
  return match ? match.slice(1).map(Number) : null
}

function compareVersions(left, right) {
  const leftParts = versionParts(left)
  const rightParts = versionParts(right)
  if (!leftParts || !rightParts) return Number.NaN
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return leftParts[index] - rightParts[index]
    }
  }
  return 0
}

async function run() {
  assert(Array.isArray(releases) && releases.length > 0, 'Release log is empty')
  assert(packageJson.version === appVersion, 'Project versions are inconsistent')
  assert(
    releases.at(-1)?.version === appVersion,
    'Latest release log version does not match the project version',
  )

  const seenVersions = new Set()
  for (let index = 0; index < releases.length; index += 1) {
    const release = releases[index]
    assert(versionParts(release?.version), `Invalid release version at index ${index}`)
    assert(!seenVersions.has(release.version), `Duplicate release version: ${release.version}`)
    seenVersions.add(release.version)
    assert(
      Array.isArray(release.items) && release.items.length > 0,
      `Release ${release.version} has no entries`,
    )
    assert(
      release.items.every((item) => typeof item === 'string' && item.trim()),
      `Release ${release.version} has an empty entry`,
    )
    if (index > 0) {
      assert(
        compareVersions(releases[index - 1].version, release.version) < 0,
        'Release data is not strictly ordered by semantic version',
      )
    }
  }

  assert(
    legacySource.includes("require('./releases.json')"),
    'Cloud function release loader does not use the shared JSON data',
  )
  assert(
    frontendSource.includes("cloudfunctions/api/releases.json"),
    'Frontend release log does not use the shared JSON data',
  )

  console.log(
    JSON.stringify(
      {
        releaseCount: releases.length,
        latestRelease: releases.at(-1).version,
        sharedJsonSource: true,
        frontendAndCloudFunctionAligned: true,
        semanticVersionOrder: true,
      },
      null,
      2,
    ),
  )
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
