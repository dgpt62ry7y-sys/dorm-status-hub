const crypto = require('node:crypto')
const path = require('node:path')
const {
  createMemoryDatabase,
  installCloudBaseMock,
} = require('./support/memory-cloudbase.cjs')

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

function expectError(result, code) {
  if (result.ok || result.error.code !== code) {
    throw new Error(`Expected ${code}, received ${JSON.stringify(result)}`)
  }
}

function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

async function run() {
  const suffix = String(Date.now()).slice(-6)
  const created = ok(
    await invoke({
      action: 'createRoom',
      roomName: `多设备测试${suffix}`,
      nickname: `房主${suffix}`,
      deviceLabel: 'Windows · Chrome',
    }),
    'createRoom',
  )
  if (!created.recoveryCode || created.recoveryCode.length !== 20) {
    throw new Error('Recovery code was not issued')
  }
  if (!created.state.currentDeviceId) throw new Error('Current device missing')

  const ownerToken = created.memberToken
  const ownerMemberId = created.state.currentMemberId
  const recoveryCode = created.recoveryCode
  const inviteCode = created.state.room.inviteCode

  const binding = ok(
    await invoke({ action: 'createDeviceLink', memberToken: ownerToken }),
    'createDeviceLink',
  )
  if (binding.code.length !== 8) throw new Error('Binding code has wrong length')

  const secondDevice = ok(
    await invoke({
      action: 'claimDeviceLink',
      code: binding.code,
      deviceLabel: 'iPhone · 微信',
    }),
    'claimDeviceLink',
  )
  if (secondDevice.state.currentMemberId !== ownerMemberId) {
    throw new Error('Bound device belongs to another member')
  }
  expectError(
    await invoke({
      action: 'claimDeviceLink',
      code: binding.code,
      deviceLabel: '重复设备',
    }),
    'DEVICE_LINK_USED',
  )

  ok(
    await invoke({
      action: 'updateStatus',
      memberToken: secondDevice.memberToken,
      status: 'focus',
      note: '跨设备同步测试',
      endAt: null,
    }),
    'updateStatus',
  )
  const synced = ok(
    await invoke({ action: 'getState', memberToken: ownerToken }),
    'getState after update',
  )
  if (synced.statuses.find((status) => status.memberId === ownerMemberId)?.note !== '跨设备同步测试') {
    throw new Error('Second device status did not reach first device')
  }

  expectError(
    await invoke({
      action: 'updateStatus',
      memberToken: ownerToken,
      status: 'away',
      note: '去图书馆',
      endAt: null,
    }),
    'END_TIME_REQUIRED',
  )
  const awayEnd = new Date(Date.now() + 60 * 60_000).toISOString()
  const awayState = ok(
    await invoke({
      action: 'updateStatus',
      memberToken: ownerToken,
      status: 'away',
      note: '去图书馆',
      endAt: awayEnd,
    }),
    'update away status',
  )
  const awayRecord = awayState.statuses.find((status) => status.memberId === ownerMemberId)
  if (awayRecord?.status !== 'away' || awayRecord.endAt !== awayEnd) {
    throw new Error('Away return time was not stored')
  }

  const storedAway = database.data
    .get('statuses')
    .find((status) => status.memberId === ownerMemberId)
  storedAway.endAt = new Date(Date.now() - 1000).toISOString()
  const expiredAway = ok(
    await invoke({ action: 'getState', memberToken: ownerToken }),
    'expire away status',
  )
  const expiredAwayRecord = expiredAway.statuses.find(
    (status) => status.memberId === ownerMemberId,
  )
  if (
    expiredAwayRecord?.status !== 'normal' ||
    expiredAwayRecord.note !== '' ||
    expiredAwayRecord.endAt !== null
  ) {
    throw new Error('Expired away status did not clear note and return time')
  }

  storedAway.status = 'normal'
  storedAway.note = '预计时间已结束'
  storedAway.endAt = null
  const cleanedLegacy = ok(
    await invoke({ action: 'getState', memberToken: ownerToken }),
    'clean legacy expiry note',
  )
  if (
    cleanedLegacy.statuses.find((status) => status.memberId === ownerMemberId)?.note !== ''
  ) {
    throw new Error('Legacy expiry note was not removed')
  }

  const firstList = ok(
    await invoke({ action: 'listDevices', memberToken: ownerToken }),
    'listDevices',
  )
  if (firstList.devices.length !== 2) throw new Error('Expected two device sessions')
  if (!firstList.devices.find((device) => device.isCurrent)) {
    throw new Error('Current device marker missing')
  }

  const rotated = ok(
    await invoke({ action: 'rotateRecoveryCode', memberToken: ownerToken }),
    'rotateRecoveryCode',
  )
  if (rotated.recoveryCode === recoveryCode) throw new Error('Recovery code did not rotate')
  expectError(
    await invoke({
      action: 'recoverAccount',
      recoveryCode,
      deviceLabel: '旧恢复码设备',
    }),
    'RECOVERY_CODE_INVALID',
  )

  const recovered = ok(
    await invoke({
      action: 'recoverAccount',
      recoveryCode: rotated.recoveryCode,
      deviceLabel: 'iPad · Safari',
    }),
    'recoverAccount',
  )

  const expiredLink = ok(
    await invoke({ action: 'createDeviceLink', memberToken: ownerToken }),
    'createDeviceLink for expiry',
  )
  const storedLink = [...database.data.get('deviceLinks')]
    .reverse()
    .find((link) => link.active && link.codeHash === hash(expiredLink.code))
  storedLink.expiresAt = new Date(Date.now() - 1000).toISOString()
  expectError(
    await invoke({
      action: 'claimDeviceLink',
      code: expiredLink.code,
      deviceLabel: '过期设备',
    }),
    'DEVICE_LINK_EXPIRED',
  )

  const secondList = ok(
    await invoke({ action: 'listDevices', memberToken: secondDevice.memberToken }),
    'listDevices for revoke',
  )
  const secondSessionId = secondList.currentDeviceId
  const revoked = ok(
    await invoke({
      action: 'revokeDevice',
      memberToken: ownerToken,
      deviceId: secondSessionId,
    }),
    'revokeDevice',
  )
  if (revoked.revokedCurrent) throw new Error('Remote device was treated as current')
  expectError(
    await invoke({ action: 'getState', memberToken: secondDevice.memberToken }),
    'AUTH_REQUIRED',
  )

  while (true) {
    const current = ok(
      await invoke({ action: 'listDevices', memberToken: ownerToken }),
      'listDevices while filling',
    )
    if (current.devices.length >= 5) break
    const link = ok(
      await invoke({ action: 'createDeviceLink', memberToken: ownerToken }),
      'createDeviceLink while filling',
    )
    ok(
      await invoke({
        action: 'claimDeviceLink',
        code: link.code,
        deviceLabel: `测试设备 ${current.devices.length + 1}`,
      }),
      'claimDeviceLink while filling',
    )
  }

  expectError(
    await invoke({ action: 'createDeviceLink', memberToken: ownerToken }),
    'DEVICE_LIMIT_REACHED',
  )
  expectError(
    await invoke({
      action: 'recoverAccount',
      recoveryCode: rotated.recoveryCode,
      deviceLabel: '超额设备',
    }),
    'DEVICE_LIMIT_REACHED',
  )

  const joined = ok(
    await invoke({
      action: 'joinRoom',
      inviteCode,
      nickname: `待移除成员${suffix}`,
      deviceLabel: 'Android · Chrome',
    }),
    'joinRoom',
  )
  ok(
    await invoke({
      action: 'removeMember',
      memberToken: ownerToken,
      memberId: joined.state.currentMemberId,
    }),
    'removeMember',
  )
  expectError(
    await invoke({ action: 'getState', memberToken: joined.memberToken }),
    'AUTH_REQUIRED',
  )

  const beforeDeviceExit = ok(
    await invoke({ action: 'getState', memberToken: ownerToken }),
    'getState before device exit',
  )
  const recoveredList = ok(
    await invoke({ action: 'listDevices', memberToken: recovered.memberToken }),
    'listDevices recovered',
  )
  const currentRevoked = ok(
    await invoke({
      action: 'revokeDevice',
      memberToken: recovered.memberToken,
      deviceId: recoveredList.currentDeviceId,
    }),
    'revoke current device',
  )
  if (!currentRevoked.revokedCurrent) {
    throw new Error('Current device revoke was not identified')
  }
  expectError(
    await invoke({ action: 'getState', memberToken: recovered.memberToken }),
    'AUTH_REQUIRED',
  )
  const afterDeviceExit = ok(
    await invoke({ action: 'getState', memberToken: ownerToken }),
    'getState after device exit',
  )
  if (afterDeviceExit.members.length !== beforeDeviceExit.members.length) {
    throw new Error('Exiting a device removed the member from the room')
  }

  expectError(
    await invoke({
      action: 'createRoom',
      roomName: `非法容量${suffix}`,
      nickname: `非法容量${suffix}`,
      capacity: 5,
    }),
    'INVALID_CAPACITY',
  )

  const sixPerson = ok(
    await invoke({
      action: 'createRoom',
      roomName: `六人寝${suffix}`,
      nickname: `六人房主${suffix}`,
      deviceLabel: 'Windows · Chrome',
      capacity: 6,
    }),
    'create six-person room',
  )
  if (sixPerson.state.room.capacity !== 6) throw new Error('Six-person capacity missing')
  const sixOwnerToken = sixPerson.memberToken
  const sixInvite = sixPerson.state.room.inviteCode
  const extraMembers = []

  for (let index = 0; index < 5; index += 1) {
    const joinedSix = ok(
      await invoke({
        action: 'joinRoom',
        inviteCode: sixInvite,
        nickname: `六人成员${suffix}-${index}`,
        deviceLabel: `测试设备 ${index}`,
      }),
      `join six-person member ${index}`,
    )
    extraMembers.push(joinedSix)
  }

  expectError(
    await invoke({
      action: 'joinRoom',
      inviteCode: sixInvite,
      nickname: `第七人${suffix}`,
      deviceLabel: '超额设备',
    }),
    'ROOM_FULL',
  )
  expectError(
    await invoke({
      action: 'updateRoomCapacity',
      memberToken: extraMembers[0].memberToken,
      capacity: 4,
    }),
    'ONLY_OWNER',
  )
  expectError(
    await invoke({
      action: 'updateRoomCapacity',
      memberToken: sixOwnerToken,
      capacity: 4,
    }),
    'CAPACITY_LIMIT',
  )

  ok(
    await invoke({
      action: 'removeMember',
      memberToken: sixOwnerToken,
      memberId: extraMembers[0].state.currentMemberId,
    }),
    'remove first six-person member',
  )
  ok(
    await invoke({
      action: 'removeMember',
      memberToken: sixOwnerToken,
      memberId: extraMembers[1].state.currentMemberId,
    }),
    'remove second six-person member',
  )

  const downgraded = ok(
    await invoke({
      action: 'updateRoomCapacity',
      memberToken: sixOwnerToken,
      capacity: 4,
    }),
    'downgrade to four-person room',
  )
  if (downgraded.room.capacity !== 4) throw new Error('Downgrade did not apply')
  if (downgraded.room.inviteCode !== sixInvite) throw new Error('Invite changed on downgrade')

  const witness = extraMembers[2]
  const polledState = ok(
    await invoke({ action: 'getState', memberToken: witness.memberToken }),
    'poll without claiming capacity notice',
  )
  if (polledState.capacityNotice) {
    throw new Error('Background polling consumed the capacity notice')
  }

  const witnessLink = ok(
    await invoke({
      action: 'createDeviceLink',
      memberToken: witness.memberToken,
    }),
    'create witness device link',
  )
  const witnessSecond = ok(
    await invoke({
      action: 'claimDeviceLink',
      code: witnessLink.code,
      deviceLabel: 'Witness second device',
    }),
    'claim witness second device',
  )

  const deliveredNotice = witnessSecond.state.capacityNotice
  if (!deliveredNotice) {
    throw new Error('First device access did not receive the capacity notice')
  }
  if (deliveredNotice.from !== 6 || deliveredNotice.to !== 4) {
    throw new Error('Capacity notice has incorrect transition')
  }

  const [witnessA, witnessB] = await Promise.all([
    invoke({ action: 'getState', memberToken: witness.memberToken }),
    invoke({ action: 'getState', memberToken: witnessSecond.memberToken }),
  ])
  if (witnessA.ok && witnessA.data.capacityNotice) {
    throw new Error('Capacity notice repeated on the original device')
  }
  if (witnessB.ok && witnessB.data.capacityNotice) {
    throw new Error('Capacity notice repeated on the newly bound device')
  }

  const ownerAfterChange = ok(
    await invoke({ action: 'getState', memberToken: sixOwnerToken }),
    'owner state after capacity change',
  )
  if (ownerAfterChange.capacityNotice) {
    throw new Error('Owner received their own capacity notice')
  }

  ok(
    await invoke({
      action: 'acknowledgeCapacityNotice',
      memberToken: witnessSecond.memberToken,
      noticeId: deliveredNotice.id,
    }),
    'acknowledge capacity notice',
  )

  ok(
    await invoke({
      action: 'updateRoomCapacity',
      memberToken: sixOwnerToken,
      capacity: 6,
    }),
    'upgrade to six-person room again',
  )
  const latestChange = ok(
    await invoke({
      action: 'updateRoomCapacity',
      memberToken: sixOwnerToken,
      capacity: 4,
    }),
    'downgrade again',
  )
  if (latestChange.room.inviteCode !== sixInvite) {
    throw new Error('Invite changed on repeated capacity update')
  }

  const latestNoticeState = ok(
    await invoke({
      action: 'getState',
      memberToken: witness.memberToken,
      claimCapacityNotice: true,
    }),
    'latest capacity notice on witness',
  )
  if (!latestNoticeState.capacityNotice || latestNoticeState.capacityNotice.to !== 4) {
    throw new Error('Latest capacity notice was not delivered')
  }

  const legacyRoomId = 'legacy-room'
  const legacyMemberId = 'legacy-member'
  const legacyToken = 'legacy-token-value'
  database.data.get('rooms').push({
    _id: legacyRoomId,
    name: '旧账号宿舍',
    inviteCode: 'LEGACY',
    ownerId: legacyMemberId,
    capacity: 4,
    closed: false,
  })
  database.data.get('members').push({
    _id: legacyMemberId,
    roomId: legacyRoomId,
    nickname: '旧账号',
    role: 'owner',
    active: true,
    defaultStatus: 'normal',
    joinedAt: new Date().toISOString(),
    memberTokenHash: hash(legacyToken),
  })
  database.data.get('statuses').push({
    _id: 'legacy-status',
    memberId: legacyMemberId,
    roomId: legacyRoomId,
    status: 'normal',
    note: '',
    endAt: null,
    updatedAt: new Date().toISOString(),
  })
  const migrated = ok(
    await invoke({ action: 'getState', memberToken: legacyToken }),
    'legacy token migration',
  )
  if (!migrated.currentDeviceId) throw new Error('Legacy session did not migrate')
  const legacyMember = database.data
    .get('members')
    .find((member) => member._id === legacyMemberId)
  if (legacyMember.memberTokenHash !== null) {
    throw new Error('Legacy token hash was not retired')
  }

  console.log(
    JSON.stringify(
      {
        recoveryCodeIssued: true,
        deviceBinding: true,
        crossDeviceSync: true,
        awayReturnTimeRequired: true,
        awayAutoExpiryClearsNote: true,
        legacyExpiryNoteRemoved: true,
        currentDeviceMarker: true,
        recoveryRotation: true,
        expiredLinkRejected: true,
        usedLinkRejected: true,
        deviceRevocation: true,
        deviceLimit: true,
        memberRemovalRevokesSessions: true,
        exitDeviceKeepsMembership: true,
        sixPersonCapacity: true,
        roomFullAtSix: true,
        capacityDowngradeGuard: true,
        capacityOwnerPermission: true,
        capacityNoticeOncePerAccount: true,
        pollingDoesNotConsumeCapacityNotice: true,
        ownerSkipsCapacityNotice: true,
        inviteStableAcrossCapacityChange: true,
        latestCapacityNoticeOnly: true,
        legacyTokenMigration: true,
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
