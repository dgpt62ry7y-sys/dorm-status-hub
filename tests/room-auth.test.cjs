const path = require('node:path')
const {
  createMemoryDatabase,
  installCloudBaseMock,
} = require('./support/memory-cloudbase.cjs')

process.env.DORMSYNC_CREATOR_KEY = 'test-creator-key'
process.env.DORMSYNC_ADMIN_KEY = 'test-admin-key'

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
  if (!result.ok) throw new Error(`${label}: ${result.error.code} ${result.error.message}`)
  return result.data
}

function expectError(result, code) {
  if (result.ok || result.error.code !== code) {
    throw new Error(`Expected ${code}, received ${JSON.stringify(result)}`)
  }
}

async function createRoom(suffix, capacity = 4) {
  return ok(
    await invoke({
      action: 'createRoom',
      roomName: `授权测试${suffix}`,
      nickname: `房主${suffix}`,
      capacity,
      creatorKey: 'test-creator-key',
      deviceLabel: 'Auth Test',
    }),
    'create authorized room',
  )
}

async function run() {
  const suffix = String(Date.now()).slice(-6)
  const initialRoomCount = (database.data.get('rooms') || []).length
  expectError(
    await invoke({
      action: 'createRoom',
      roomName: `错误密钥${suffix}`,
      nickname: `错误房主${suffix}`,
      capacity: 4,
      creatorKey: 'wrong-key',
      clientIp: 'wrong-create-ip',
    }),
    'INVALID_SECRET',
  )
  if (database.data.get('rooms').length !== initialRoomCount) {
    throw new Error('Wrong key created a room')
  }

  const created = await createRoom(suffix)
  if (created.state.roomVerification) {
    throw new Error('New authorized room should not require verification')
  }
  const room = database.data
    .get('rooms')
    .find((item) => item._id === created.state.room.id)
  delete room.verificationStatus
  delete room.creatorKeyVerifiedAt

  const joined = ok(
    await invoke({
      action: 'joinRoom',
      inviteCode: created.state.room.inviteCode,
      nickname: `成员${suffix}`,
      deviceLabel: 'Pending Member',
    }),
    'join pending room',
  )

  const memberLocked = ok(
    await invoke({ action: 'getState', memberToken: joined.memberToken }),
    'member locked state',
  )
  if (
    !memberLocked.roomVerification?.required ||
    memberLocked.roomVerification.isOwner
  ) {
    throw new Error('Member was not locked behind owner verification')
  }

  const ownerPrompt = ok(
    await invoke({ action: 'getState', memberToken: created.memberToken }),
    'owner verification prompt',
  )
  if (
    !ownerPrompt.roomVerification?.required ||
    !ownerPrompt.roomVerification.isOwner ||
    !ownerPrompt.roomVerification.deadlineAt
  ) {
    throw new Error('Owner verification countdown did not start')
  }
  const deadlineHours =
    (Date.parse(ownerPrompt.roomVerification.deadlineAt) - Date.now()) / 3_600_000
  if (deadlineHours < 11.9 || deadlineHours > 12.1) {
    throw new Error('Existing room verification deadline is not 12 hours')
  }

  expectError(
    await invoke({
      action: 'verifyExistingRoom',
      memberToken: created.memberToken,
      creatorKey: 'wrong-key',
      clientIp: 'wrong-verify-ip',
    }),
    'INVALID_SECRET',
  )
  const verified = ok(
    await invoke({
      action: 'verifyExistingRoom',
      memberToken: created.memberToken,
      creatorKey: 'test-creator-key',
      clientIp: 'wrong-verify-ip',
    }),
    'verify existing room',
  )
  if (verified.roomVerification) {
    throw new Error('Room remained locked after successful verification')
  }

  const cleanupCreated = await createRoom(`${suffix}-cleanup`)
  const cleanupRoomId = cleanupCreated.state.room.id
  const cleanupRoom = database.data
    .get('rooms')
    .find((item) => item._id === cleanupRoomId)
  delete cleanupRoom.verificationStatus
  delete cleanupRoom.creatorKeyVerifiedAt
  cleanupRoom.verificationFallbackAt = new Date(Date.now() - 1000).toISOString()
  cleanupRoom.verificationDeadlineAt = new Date(Date.now() - 1000).toISOString()

  const cleanupResult = await backend.cleanup()
  if (!cleanupResult.ok || cleanupResult.data.deleted < 1) {
    throw new Error('Scheduled room cleanup did not delete expired room')
  }
  if (database.data.get('rooms').some((item) => item._id === cleanupRoomId)) {
    throw new Error('Expired room record still exists')
  }
  if (database.data.get('members').some((item) => item.roomId === cleanupRoomId)) {
    throw new Error('Expired room members still exist')
  }
  if (database.data.get('statuses').some((item) => item.roomId === cleanupRoomId)) {
    throw new Error('Expired room statuses still exist')
  }

  expectError(
    await invoke({ action: 'adminListRooms', adminKey: 'wrong-admin-key' }),
    'INVALID_SECRET',
  )
  const adminRooms = ok(
    await invoke({
      action: 'adminListRooms',
      adminKey: 'test-admin-key',
      clientIp: 'admin-read-ip',
    }),
    'admin list rooms',
  )
  const adminSummary = adminRooms.rooms.find((item) => item.id === created.state.room.id)
  if (!adminSummary || adminSummary.ownerNickname !== `房主${suffix}`) {
    throw new Error('Admin room summary is incomplete')
  }
  if (
    'statuses' in adminSummary ||
    'note' in adminSummary ||
    'creatorKey' in adminSummary ||
    'adminKey' in adminSummary
  ) {
    throw new Error('Admin summary exposed sensitive room data')
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    expectError(
      await invoke({
        action: 'createRoom',
        roomName: `限流${attempt}`,
        nickname: `限流${attempt}`,
        capacity: 4,
        creatorKey: 'wrong-key',
        clientIp: 'rate-limit-ip',
      }),
      'INVALID_SECRET',
    )
  }
  expectError(
    await invoke({
      action: 'createRoom',
      roomName: '限流最终',
      nickname: '限流最终',
      capacity: 4,
      creatorKey: 'wrong-key',
      clientIp: 'rate-limit-ip',
    }),
    'TOO_MANY_ATTEMPTS',
  )

  console.log(
    JSON.stringify(
      {
        wrongCreateRejectedWithoutRecords: true,
        existingRoomOwnerPromptStarts12Hours: true,
        membersBlockedUntilVerification: true,
        correctKeyUnlocksRoom: true,
        expiredRoomCleanupDeletesRecords: true,
        adminListIsReadOnlyAndSanitized: true,
        failedAttemptsRateLimited: true,
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
