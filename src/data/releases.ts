import releaseRecords from '../../cloudfunctions/api/releases.json'

export interface ReleaseLogEntry {
  version: string
  items: string[]
}

function versionParts(version: string): number[] {
  return version.split('.').map((part) => Number(part) || 0)
}

function compareVersions(left: string, right: string): number {
  const leftParts = versionParts(left)
  const rightParts = versionParts(right)
  for (let index = 0; index < 3; index += 1) {
    const difference = (leftParts[index] || 0) - (rightParts[index] || 0)
    if (difference !== 0) return difference
  }
  return 0
}

export const RELEASE_LOG: ReleaseLogEntry[] = [...releaseRecords].sort((left, right) =>
  compareVersions(right.version, left.version),
)

export const LATEST_RELEASE_VERSION = RELEASE_LOG[0]?.version || ''
