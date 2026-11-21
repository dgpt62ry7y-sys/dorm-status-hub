const crypto = require('node:crypto')
const path = require('node:path')
const {
  createMemoryDatabase,
  installCloudBaseMock,
} = require('./support/memory-cloudbase.cjs')

process.env.DORMSYNC_CREATOR_KEY = 'test-creator-key'
process.env.DORMSYNC_ADMIN_KEY = 'test-admin-key'
process.env.DORMSYNC_NTFY_SERVER = 'https://ntfy.test/'
process.env.DORMSYNC_NTFY_PUBLIC_URL = 'https://ntfy.sh'
process.env.DORMSYNC_BARK_ENCRYPTION_KEY = '0123456789abcdef'.repeat(4)

const database = createMemoryDatabase()
const restoreCloudBase = installCloudBaseMock(database)

const ntfyRequests = []
const barkRequests = []
let ntfyOk = true
let barkHttpOk = true
let barkCodes = []

global.fetch = async (url, options = {}) => {
  const target = String(url)
  if (target.startsWith('https://ntfy.test/')) {
    ntfyRequests.push({
      url: target,
      headers: { ...(options.headers || {}) },
      body: String(options.body || ''),
    })
    return {
      ok: ntfyOk,
      status: ntfyOk ? 200 : 503,
    }
  }

  if (target === 'https://api.day.app/push') {
    const payload = JSON.parse(String(options.body || '{}'))
    barkRequests.push({ url: target, payload })
    const deviceKeys = Array.isArray(payload.device_keys) ? payload.device_keys : []
    return {
      ok: barkHttpOk,
      status: barkHttpOk ? 200 : 503,
      async json() {
        return {
          code: 200,
          message: 'success',
          data: deviceKeys.map((_, index) => ({
            code: barkCodes[index] || 200,
            device_key: 'not-retained',
          })),
        }
      },
      async text() {
        return '{"code":200,"message":"success"}'
      },
    }
  }

  throw new Error(`Unexpected fetch target: ${target}`)
}

const backend = require(path.join(__dirname, '..', 'cloudfunctions', 'api', 'index.js'))
restoreCloudBase()

const key1 = 'Abcdefghijk1234567890X'
const key2 = 'Zyxwvutsrq9876543210A'
const key3 = 'Mnpqrstuvw1234567890BC'
const key4 = 'HijkLMNOPQ1234567890DE'
const key5 = 'RstuvWXYZa1234567890FG'
const key6 = 'CdefghijkL1234567890HI'
const key7 = 'TuvwxyzABC1234567890JK'
const key8 = 'EfghijkLMN1234567890PQ'
const key9 = 'WxyzABCDE1234567890RS'
const key10 = 'GijkLMNOPQ1234567890TU'

async function invoke(payload) {
  const clientIp = payload.clientIp || 'bark-test'
  const response = await backend.main({
    httpMethod: 'POST',
    body: JSON.stringify(payload),
    requestContext: {
      http: {
        sourceIp: clientIp,
      },
    },
  })
  return JSON.parse(response.body)
}

function ok(result, label) {
  if (!result.ok) {
    throw new Error(`${label}: ${result.error.code} ${result.error.message}`)
  }
  return result.data
}

function expectError(result, code, label) {
  if (result.ok || result.error.code !== code) {
    throw new Error(`${label}: expected ${code}, received ${JSON.stringify(result)}`)
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function clearBarkCooldown(memberId) {
  const member = database.data.get('members').find((item) => item._id === memberId)
  member.lastBarkTestAt = null
}

async function joinRoom(room, nickname) {
  return ok(
    await invoke({
      action: 'joinRoom',
      inviteCode: room.room?.inviteCode || room.inviteCode,
      nickname,
      deviceLabel: `${nickname} Device`,
      joinRequestId: crypto.randomUUID(),
      deviceInstanceId: crypto.randomUUID(),
    }),
    `join ${nickname}`,
  )
}

async function registerBark(member, deviceKey, label) {
  clearBarkCooldown(member.memberId)
  return invoke({
    action: 'registerBarkDevice',
    memberToken: member.memberToken,
    deviceKey,
    deviceLabel: label,
  })
}

async function run() {
  const suffix = String(Date.now()).slice(-6)
  const created = ok(
    await invoke({
      action: 'createRoom',
      roomName: `Bark 测试${suffix}`,
      nickname: `Bark 房主${suffix}`,
      capacity: 4,
      creatorKey: 'test-creator-key',
      deviceLabel: 'Bark Owner',
    }),
    'create room',
  )
  const ownerToken = created.memberToken
  const ownerId = created.state.currentMemberId
  const owner = { memberId: ownerId, memberToken: ownerToken }
  const joinedA = await joinRoom(created.state, `Bark 成员A${suffix}`)
  const memberA = {
    memberId: joinedA.state.currentMemberId,
    memberToken: joinedA.memberToken,
    nickname: `Bark 成员A${suffix}`,
  }
  const joinedB = await joinRoom(created.state, `Bark 成员B${suffix}`)
  const memberB = {
    memberId: joinedB.state.currentMemberId,
    memberToken: joinedB.memberToken,
    nickname: `Bark 成员B${suffix}`,
  }
  const joinedC = await joinRoom(created.state, `Bark 成员C${suffix}`)
  const memberC = {
    memberId: joinedC.state.currentMemberId,
    memberToken: joinedC.memberToken,
    nickname: `Bark 成员C${suffix}`,
  }

  expectError(
    await invoke({
      action: 'registerBarkDevice',
      memberToken: ownerToken,
      deviceKey: `http://api.day.app/${key1}`,
      deviceLabel: 'HTTP URL',
    }),
    'INVALID_BARK_KEY',
    'reject HTTP Bark URL',
  )
  expectError(
    await invoke({
      action: 'registerBarkDevice',
      memberToken: ownerToken,
      deviceKey: `https://evil.example/${key1}`,
      deviceLabel: 'Wrong host',
    }),
    'INVALID_BARK_KEY',
    'reject non-official Bark URL',
  )
  expectError(
    await invoke({
      action: 'registerBarkDevice',
      memberToken: ownerToken,
      deviceKey: `x${key1.repeat(4)}`,
      deviceLabel: 'Too long',
    }),
    'INVALID_BARK_KEY',
    'reject oversized Bark key',
  )

  const firstRegistration = ok(
    await invoke({
      action: 'registerBarkDevice',
      memberToken: ownerToken,
      deviceKey: `https://api.day.app/${key1}/DormSync/测试`,
      deviceLabel: '主人 iPhone',
    }),
    'register official Bark URL',
  )
  assert(firstRegistration.device.maskedKey.endsWith(key1.slice(-4)), 'Masked key is incorrect')
  assert(
    JSON.stringify(firstRegistration).includes(key1) === false,
    'Registration response exposed the full Bark key',
  )
  const firstBarkRequest = barkRequests.at(-1)
  assert(firstBarkRequest.payload.level === 'active', 'Bark test level is incorrect')
  assert(firstBarkRequest.payload.group === 'DormSync', 'Bark test group is incorrect')
  assert(
    firstBarkRequest.payload.device_keys.length === 1 &&
      firstBarkRequest.payload.device_keys[0] === key1,
    'Bark test did not use the submitted key',
  )

  const storedRows = database.data.get('pushSubscriptions')
  assert(storedRows.length === 1, 'Bark subscription was not saved after successful test')
  assert(
    !JSON.stringify(storedRows[0]).includes(key1),
    'Bark key was stored in plaintext',
  )
  assert(
    storedRows[0].keyFingerprint === hash(`bark-device:${key1}`),
    'Bark key fingerprint is incorrect',
  )
  assert(
    storedRows[0].encryptedKey.startsWith('v1.'),
    'Bark key encryption format is not versioned',
  )

  expectError(
    await invoke({
      action: 'registerBarkDevice',
      memberToken: ownerToken,
      deviceKey: key1,
      deviceLabel: 'Too soon',
    }),
    'NOTIFICATION_RATE_LIMITED',
    'Bark registration test cooldown',
  )

  ok(await registerBark(owner, key1, '主人 iPhone 更新'), 'update duplicate Bark device')
  assert(
    database.data.get('pushSubscriptions').length === 1,
    'Duplicate Bark key created another subscription',
  )
  assert(
    database.data
      .get('pushSubscriptions')
      .find((item) => item.memberId === ownerId)?.deviceLabel === '主人 iPhone 更新',
    'Duplicate Bark registration did not update the label',
  )

  ok(await registerBark(owner, key2, '主人 iPad'), 'register second owner device')
  ok(await registerBark(memberA, key3, '成员 A iPhone'), 'register member A device')
  ok(await registerBark(memberB, key1, '成员 B 共用设备'), 'register duplicate key for member B')

  const ownerList = ok(
    await invoke({ action: 'listBarkDevices', memberToken: ownerToken }),
    'list owner Bark devices',
  )
  assert(ownerList.devices.length === 2, 'Owner Bark device count is incorrect')
  assert(ownerList.configured, 'Bark configured flag is incorrect')
  assert(
    JSON.stringify(ownerList).includes(key1) === false &&
      JSON.stringify(ownerList).includes(key2) === false,
    'Bark list exposed a full key',
  )

  const memberADevice = database.data
    .get('pushSubscriptions')
    .find((item) => item.memberId === memberA.memberId)
  expectError(
    await invoke({
      action: 'testBarkNotification',
      memberToken: memberB.memberToken,
      deviceId: memberADevice._id,
    }),
    'BARK_DEVICE_NOT_FOUND',
    'cross-member Bark test',
  )
  expectError(
    await invoke({
      action: 'removeBarkDevice',
      memberToken: memberB.memberToken,
      deviceId: memberADevice._id,
    }),
    'BARK_DEVICE_NOT_FOUND',
    'cross-member Bark removal',
  )

  ntfyRequests.length = 0
  barkRequests.length = 0
  barkCodes = []
  const focusEnd = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()
  const focused = ok(
    await invoke({
      action: 'updateStatus',
      memberToken: ownerToken,
      status: 'focus',
      note: 'Bark 双通道',
      endAt: focusEnd,
    }),
    'status with dual channels',
  )
  assert(!focused.notificationWarning, 'Dual-channel status returned a warning')
  assert(ntfyRequests.length === 1, 'Status did not send exactly one ntfy request')
  assert(barkRequests.length === 1, 'Status did not send exactly one Bark batch')
  const batchKeys = barkRequests[0].payload.device_keys
  assert(batchKeys.length === 3, 'Bark batch did not deduplicate room device keys')
  assert(
    new Set(batchKeys).size === 3 &&
      batchKeys.includes(key1) &&
      batchKeys.includes(key2) &&
      batchKeys.includes(key3),
    'Bark batch keys are incorrect',
  )
  assert(
    barkRequests[0].payload.body === ntfyRequests[0].body,
    'ntfy and Bark received different notification bodies',
  )

  barkCodes = [200, 500, 200]
  const partial = ok(
    await invoke({
      action: 'updateStatus',
      memberToken: ownerToken,
      status: 'focus',
      note: 'Bark 部分失败',
      endAt: focusEnd,
    }),
    'status with partial Bark failure',
  )
  assert(
    partial.notificationWarning === '状态已保存，但部分宿舍通知发送失败',
    'Partial Bark failure warning is missing',
  )
  assert(
    database.data
      .get('statuses')
      .find((item) => item.memberId === ownerId)?.note === 'Bark 部分失败',
    'Bark failure rolled back the saved status',
  )

  const key2Row = database.data
    .get('pushSubscriptions')
    .find((item) => item.keyFingerprint === hash(`bark-device:${key2}`) && item.memberId === ownerId)
  key2Row.encryptedKey = `${key2Row.encryptedKey.slice(0, -4)}aaaa`
  barkCodes = []
  barkRequests.length = 0
  const tampered = ok(
    await invoke({
      action: 'updateStatus',
      memberToken: ownerToken,
      status: 'focus',
      note: 'Bark 密文篡改',
      endAt: focusEnd,
    }),
    'status with tampered Bark ciphertext',
  )
  assert(tampered.notificationWarning, 'Tampered Bark ciphertext did not warn')
  assert(
    !barkRequests[0].payload.device_keys.includes(key2),
    'Tampered Bark key was sent',
  )

  process.env.DORMSYNC_BARK_ENCRYPTION_KEY = 'fedcba9876543210'.repeat(4)
  clearBarkCooldown(ownerId)
  const ownerDevice = database.data
    .get('pushSubscriptions')
    .find((item) => item.memberId === ownerId && item.keyFingerprint === hash(`bark-device:${key1}`))
  expectError(
    await invoke({
      action: 'testBarkNotification',
      memberToken: ownerToken,
      deviceId: ownerDevice._id,
    }),
    'BARK_DEVICE_INVALID',
    'wrong Bark encryption key',
  )
  process.env.DORMSYNC_BARK_ENCRYPTION_KEY = '0123456789abcdef'.repeat(4)

  clearBarkCooldown(ownerId)
  ok(
    await invoke({
      action: 'testBarkNotification',
      memberToken: ownerToken,
      deviceId: ownerDevice._id,
    }),
    'saved Bark device test',
  )
  expectError(
    await invoke({
      action: 'testBarkNotification',
      memberToken: ownerToken,
      deviceId: ownerDevice._id,
    }),
    'NOTIFICATION_RATE_LIMITED',
    'saved Bark device test cooldown',
  )

  barkHttpOk = false
  clearBarkCooldown(memberB.memberId)
  expectError(
    await invoke({
      action: 'registerBarkDevice',
      memberToken: memberB.memberToken,
      deviceKey: key2,
      deviceLabel: '失败设备',
    }),
    'BARK_TEST_FAILED',
    'Bark failed test is not saved',
  )
  assert(
    !database.data
      .get('pushSubscriptions')
      .some((item) => item.memberId === memberB.memberId && item.keySuffix === key2.slice(-4)),
    'Failed Bark device registration was saved',
  )
  barkHttpOk = true

  const capKeys = [key4, key5, key6, key7, key8]
  for (const [index, key] of capKeys.entries()) {
    ok(await registerBark(memberC, key, `成员 C 设备 ${index + 1}`), `register cap device ${index}`)
  }
  const requestsBeforeLimit = barkRequests.length
  expectError(
    await registerBark(memberC, key9, '第六台设备'),
    'BARK_DEVICE_LIMIT',
    'Bark device limit',
  )
  assert(
    barkRequests.length === requestsBeforeLimit,
    'Bark API was called after reaching the device limit',
  )

  const memberARowsBeforeRemoval = database.data
    .get('pushSubscriptions')
    .filter((item) => item.memberId === memberA.memberId).length
  assert(memberARowsBeforeRemoval === 1, 'Member A Bark setup is incomplete')
  ok(
    await invoke({
      action: 'removeMember',
      memberToken: ownerToken,
      memberId: memberA.memberId,
    }),
    'remove member with Bark device',
  )
  assert(
    !database.data
      .get('pushSubscriptions')
      .some((item) => item.memberId === memberA.memberId),
    'Removed member Bark devices remain active',
  )

  const ownerRowsBeforeSessionRevoke = database.data
    .get('pushSubscriptions')
    .filter((item) => item.memberId === ownerId).length
  const link = ok(
    await invoke({ action: 'createDeviceLink', memberToken: ownerToken }),
    'create session for Bark isolation',
  )
  const secondSession = ok(
    await invoke({
      action: 'claimDeviceLink',
      code: link.code,
      deviceLabel: 'Temporary session',
    }),
    'claim temporary session',
  )
  const secondDeviceList = ok(
    await invoke({
      action: 'listDevices',
      memberToken: secondSession.memberToken,
    }),
    'list temporary sessions',
  )
  ok(
    await invoke({
      action: 'revokeDevice',
      memberToken: ownerToken,
      deviceId: secondDeviceList.currentDeviceId,
    }),
    'revoke temporary session',
  )
  assert(
    database.data
      .get('pushSubscriptions')
      .filter((item) => item.memberId === ownerId).length === ownerRowsBeforeSessionRevoke,
    'Revoking a browser session removed Bark devices',
  )

  const memberBRowsBeforeLeave = database.data
    .get('pushSubscriptions')
    .filter((item) => item.memberId === memberB.memberId).length
  assert(memberBRowsBeforeLeave === 1, 'Member B Bark setup is incomplete')
  ok(
    await invoke({ action: 'leaveRoom', memberToken: memberB.memberToken }),
    'member B leaves',
  )
  assert(
    !database.data
      .get('pushSubscriptions')
      .some((item) => item.memberId === memberB.memberId),
    'Leaving member Bark devices remain active',
  )

  const memberCStatus = database.data
    .get('statuses')
    .find((item) => item.memberId === memberC.memberId)
  memberCStatus.status = 'focus'
  memberCStatus.note = '自动过期无通知'
  memberCStatus.endAt = new Date(Date.now() + 60_000).toISOString()
  clearBarkCooldown(memberC.memberId)
  ok(
    await invoke({
      action: 'updateStatus',
      memberToken: memberC.memberToken,
      status: 'focus',
      note: '自动过期无通知',
      endAt: memberCStatus.endAt,
    }),
    'seed expiring status',
  )
  ntfyRequests.length = 0
  barkRequests.length = 0
  memberCStatus.endAt = new Date(Date.now() - 1_000).toISOString()
  ok(
    await invoke({ action: 'getState', memberToken: ownerToken }),
    'expire Bark test status',
  )
  assert(ntfyRequests.length === 0, 'Automatic expiry sent ntfy')
  assert(barkRequests.length === 0, 'Automatic expiry sent Bark')

  ntfyOk = false
  barkCodes = []
  const ntfyFailure = ok(
    await invoke({
      action: 'updateStatus',
      memberToken: ownerToken,
      status: 'normal',
      note: '',
      endAt: null,
    }),
    'ntfy failure with Bark success',
  )
  assert(ntfyFailure.notificationWarning, 'ntfy failure with Bark success did not warn')
  assert(
    barkRequests.at(-1)?.payload.level === 'active',
    'Bark was not attempted when ntfy failed',
  )

  console.log(
    JSON.stringify(
      {
        barkUrlAndKeyValidation: true,
        encryptedStorage: true,
        maskedResponses: true,
        duplicateRegistrationDeduplication: true,
        fiveDeviceLimit: true,
        crossMemberPermissionIsolation: true,
        dualChannelFanout: true,
        batchDeduplication: true,
        partialFailureKeepsStatus: true,
        tamperedCiphertextRejected: true,
        wrongEncryptionKeyRejected: true,
        failedRegistrationNotSaved: true,
        memberRemovalAndLeaveCleanup: true,
        sessionRevokeKeepsBark: true,
        automaticExpiryDoesNotNotify: true,
        ntfyFailureDoesNotBlockBark: true,
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
