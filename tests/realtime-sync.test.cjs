const path = require('node:path')
const {
  createMemoryDatabase,
  installCloudBaseMock,
} = require('./support/memory-cloudbase.cjs')

process.env.DORMSYNC_CREATOR_KEY = 'test-creator-key'
process.env.DORMSYNC_ADMIN_KEY = 'test-admin-key'

global.fetch = async () => ({ ok: true, status: 200 })

const database = createMemoryDatabase()
const restoreCloudBase = installCloudBaseMock(database)
const backend = require(path.join(__dirname, '..', 'cloudfunctions', 'api', 'index.js'))
restoreCloudBase()

async function invoke(payload) {
  const response = await backend.main({
    httpMethod: 'POST',
    body: JSON.stringify(payload),
  })
  return JSON.parse(response.body)
}

function ok(result, label) {
  if (!result.ok) {
    throw new Error(`${label}: ${result.error.code} ${result.error.message}`)
  }
  return result.data
}

function expect(condition, message) {
  if (!condition) throw new Error(message)
}

async function run() {
  const created = ok(
    await invoke({
      action: 'createRoom',
      roomName: '实时同步测试寝',
      nickname: '实时房主',
      deviceLabel: '测试浏览器',
      creatorKey: 'test-creator-key',
    }),
    'createRoom',
  )

  const memberId = created.state.currentMemberId
  const deviceId = created.state.currentDeviceId
  const members = database.data.get('members')
  const sessions = database.data.get('deviceSessions')
  const member = members.find((item) => item._id === memberId)
  const session = sessions.find((item) => item._id === deviceId)
  const beforeMemberSeen = member.lastSeenAt
  const beforeSessionSeen = session.lastSeenAt

  const first = ok(
    await invoke({ action: 'getState', memberToken: created.memberToken }),
    'first getState',
  )
  expect(
    member.lastSeenAt === beforeMemberSeen,
    'Presence was rewritten before the throttle window elapsed',
  )
  expect(
    session.lastSeenAt === beforeSessionSeen,
    'Device presence was rewritten before the throttle window elapsed',
  )
  expect(
    first.room.realtime?.serverUrl === 'https://ntfy.sh',
    'Realtime server URL is missing',
  )
  expect(Boolean(first.room.realtime?.topic), 'Realtime topic is missing')

  const staleAt = new Date(Date.now() - 6 * 60_000).toISOString()
  member.lastSeenAt = staleAt
  session.lastSeenAt = staleAt
  ok(
    await invoke({ action: 'getState', memberToken: created.memberToken }),
    'getState after stale window',
  )

  expect(member.lastSeenAt !== staleAt, 'Member presence did not refresh')
  expect(session.lastSeenAt !== staleAt, 'Device presence did not refresh')
  expect(
    member.lastSeenAt === session.lastSeenAt,
    'Member and device presence were not refreshed together',
  )
  expect(
    backend.__testPresence.intervalMs === 5 * 60_000,
    'Presence interval is not five minutes',
  )
  expect(
    backend.__testPresence.isPresenceStale(staleAt),
    'Stale presence helper returned false',
  )

  console.log(
    JSON.stringify({
      realtimeConfigPresent: true,
      throttleSkipsRecentWrites: true,
      stalePresenceRefreshes: true,
      presenceIntervalMs: backend.__testPresence.intervalMs,
    }),
  )
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
