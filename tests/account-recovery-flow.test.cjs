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

function expectError(result, code) {
  if (result.ok || result.error.code !== code) {
    throw new Error(`Expected ${code}, received ${JSON.stringify(result)}`)
  }
}

function expect(condition, message) {
  if (!condition) throw new Error(message)
}

async function createRoom(suffix) {
  return ok(
    await invoke({
      action: 'createRoom',
      roomName: `恢复测试寝${suffix}`,
      nickname: `房主${suffix}`,
      capacity: 6,
      creatorKey: 'test-creator-key',
      deviceLabel: 'Owner Device',
      deviceInstanceId: crypto.randomUUID(),
    }),
    'createRoom',
  )
}

async function joinMember(inviteCode, nickname, options = {}) {
  const joinRequestId = options.joinRequestId || crypto.randomUUID()
  const deviceInstanceId = options.deviceInstanceId || crypto.randomUUID()
  const result = await invoke({
    action: 'joinRoom',
    inviteCode,
    nickname,
    deviceLabel: `${nickname} Device`,
    joinRequestId,
    deviceInstanceId,
  })
  return { result, joinRequestId, deviceInstanceId }
}

async function fillDevices(memberToken) {
  while (true) {
    const current = ok(
      await invoke({ action: 'listDevices', memberToken }),
      'listDevices while filling',
    )
    if (current.devices.length >= 5) return current
    const link = ok(
      await invoke({ action: 'createDeviceLink', memberToken }),
      'createDeviceLink',
    )
    ok(
      await invoke({
        action: 'claimDeviceLink',
        code: link.code,
        deviceLabel: `Recovery Fill ${current.devices.length + 1}`,
        deviceInstanceId: crypto.randomUUID(),
      }),
      'claimDeviceLink',
    )
  }
}

async function run() {
  const suffix = String(Date.now()).slice(-6)
  const created = await createRoom(suffix)
  const ownerToken = created.memberToken
  const room = created.state.room

  const memberOne = await joinMember(room.inviteCode, `成员甲${suffix}`)
  const joinedOne = ok(memberOne.result, 'join member one')
  const duplicateOne = await joinMember(room.inviteCode, `成员甲${suffix}`, {
    joinRequestId: memberOne.joinRequestId,
    deviceInstanceId: memberOne.deviceInstanceId,
  })
  const duplicateOneData = ok(duplicateOne.result, 'repeat join member one')
  expect(
    duplicateOneData.state.currentMemberId === joinedOne.state.currentMemberId,
    'Repeated join created another member',
  )
  const duplicateMismatch = await joinMember(room.inviteCode, `成员甲${suffix}`, {
    joinRequestId: memberOne.joinRequestId,
    deviceInstanceId: crypto.randomUUID(),
  })
  expectError(duplicateMismatch.result, 'JOIN_REQUEST_CONFLICT')
  const sameDeviceNewRequest = await joinMember(room.inviteCode, `成员甲重复${suffix}`, {
    deviceInstanceId: memberOne.deviceInstanceId,
  })
  expectError(sameDeviceNewRequest.result, 'DEVICE_ALREADY_BOUND')

  const memberTwo = ok(
    (await joinMember(room.inviteCode, `成员乙${suffix}`)).result,
    'join member two',
  )
  const memberThree = ok(
    (await joinMember(room.inviteCode, `成员丙${suffix}`)).result,
    'join member three',
  )

  const otherRoom = await createRoom(`${suffix}B`)
  expectError(
    await invoke({
      action: 'recoverAccount',
      inviteCode: otherRoom.state.room.inviteCode,
      recoveryCode: created.recoveryCode,
      deviceLabel: 'Wrong Room',
      deviceInstanceId: crypto.randomUUID(),
    }),
    'RECOVERY_CODE_INVALID',
  )
  const personalRecovery = ok(
    await invoke({
      action: 'recoverAccount',
      inviteCode: room.inviteCode,
      recoveryCode: created.recoveryCode,
      deviceLabel: 'Personal Recovery',
      deviceInstanceId: crypto.randomUUID(),
    }),
    'personal recovery',
  )
  expect(
    personalRecovery.state.currentMemberId === created.state.currentMemberId,
    'Personal recovery did not restore the owner member',
  )

  const memberCode = ok(
    await invoke({
      action: 'createMemberRecoveryCode',
      memberToken: ownerToken,
      targetMemberId: joinedOne.state.currentMemberId,
    }),
    'createMemberRecoveryCode',
  )
  const memberRecovery = ok(
    await invoke({
      action: 'recoverWithAssistance',
      inviteCode: room.inviteCode,
      recoveryMode: 'member',
      recoveryCodes: [memberCode.code],
      deviceLabel: 'Member Assistance',
      deviceInstanceId: crypto.randomUUID(),
    }),
    'member assistance recovery',
  )
  expect(
    memberRecovery.state.currentMemberId === joinedOne.state.currentMemberId,
    'Member assistance recovery changed the member identity',
  )
  expect(
    memberRecovery.state.members.length === created.state.members.length + 3,
    'Recovery changed room member count',
  )
  expectError(
    await invoke({
      action: 'recoverWithAssistance',
      inviteCode: room.inviteCode,
      recoveryMode: 'member',
      recoveryCodes: [memberCode.code],
      deviceLabel: 'Member Assistance Reuse',
      deviceInstanceId: crypto.randomUUID(),
    }),
    'RECOVERY_CODE_USED',
  )

  const ownerCodeA = ok(
    await invoke({
      action: 'createOwnerRecoveryCode',
      memberToken: memberTwo.memberToken,
    }),
    'createOwnerRecoveryCode A',
  )
  expectError(
    await invoke({
      action: 'recoverWithAssistance',
      inviteCode: room.inviteCode,
      recoveryMode: 'owner',
      recoveryCodes: [ownerCodeA.code],
      deviceLabel: 'Single Owner Code',
      deviceInstanceId: crypto.randomUUID(),
    }),
    'RECOVERY_CODE_INVALID',
  )
  const ownerCodeB = ok(
    await invoke({
      action: 'createOwnerRecoveryCode',
      memberToken: memberThree.memberToken,
    }),
    'createOwnerRecoveryCode B',
  )
  const ownerRecovery = ok(
    await invoke({
      action: 'recoverWithAssistance',
      inviteCode: room.inviteCode,
      recoveryMode: 'owner',
      recoveryCodes: [ownerCodeA.code, ownerCodeB.code],
      deviceLabel: 'Owner Assistance',
      deviceInstanceId: crypto.randomUUID(),
    }),
    'owner assistance recovery',
  )
  expect(
    ownerRecovery.state.currentMemberId === created.state.currentMemberId,
    'Owner assistance recovery restored another member',
  )

  const shareResetCode = ok(
    await invoke({
      action: 'createMemberRecoveryCode',
      memberToken: ownerToken,
      targetMemberId: joinedOne.state.currentMemberId,
    }),
    'create code before share rotation',
  )
  const rotatedInvite = ok(
    await invoke({ action: 'regenerateInvite', memberToken: ownerToken }),
    'rotate invite',
  )
  expectError(
    await invoke({
      action: 'recoverWithAssistance',
      inviteCode: rotatedInvite.inviteCode,
      recoveryMode: 'member',
      recoveryCodes: [shareResetCode.code],
      deviceLabel: 'Old Code After Rotation',
      deviceInstanceId: crypto.randomUUID(),
    }),
    'RECOVERY_CODE_INVALID',
  )

  const fullDeviceMember = ok(
    (await joinMember(rotatedInvite.inviteCode, `满设备成员${suffix}`)).result,
    'join full-device member',
  )
  const beforeFullRecovery = await fillDevices(fullDeviceMember.memberToken)
  expect(beforeFullRecovery.devices.length === 5, 'Failed to fill device slots')
  const fullMemberCode = ok(
    await invoke({
      action: 'createMemberRecoveryCode',
      memberToken: ownerToken,
      targetMemberId: fullDeviceMember.state.currentMemberId,
    }),
    'create full-device recovery code',
  )
  const fullRecovery = ok(
    await invoke({
      action: 'recoverWithAssistance',
      inviteCode: rotatedInvite.inviteCode,
      recoveryMode: 'member',
      recoveryCodes: [fullMemberCode.code],
      deviceLabel: 'Replacement Device',
      deviceInstanceId: crypto.randomUUID(),
    }),
    'recovery with full device list',
  )
  const afterFullRecovery = ok(
    await invoke({
      action: 'listDevices',
      memberToken: fullRecovery.memberToken,
    }),
    'list devices after replacement',
  )
  expect(
    afterFullRecovery.devices.length === 5,
    'Recovery exceeded the five-device limit',
  )
  expect(
    database.data
      .get('deviceSessions')
      .some(
        (session) =>
          session.memberId === fullDeviceMember.state.currentMemberId &&
          session.active === false &&
          session.revokedReason === 'account_recovery',
      ),
    'Oldest device was not revoked during recovery',
  )

  const audit = ok(
    await invoke({ action: 'listRecoveryAudit', memberToken: ownerToken }),
    'listRecoveryAudit',
  )
  expect(audit.entries.length >= 2, 'Recovery audit entries were not created')
  expectError(
    await invoke({
      action: 'listRecoveryAudit',
      memberToken: memberTwo.memberToken,
    }),
    'ONLY_OWNER',
  )

  console.log(
    JSON.stringify({
      joinIdempotent: true,
      recoveryRequiresShareCode: true,
      personalRecovery: true,
      memberAssistance: true,
      ownerRequiresTwoMembers: true,
      shareRotationInvalidatesCodes: true,
      fullDeviceReplacement: true,
      ownerOnlyAudit: true,
    }),
  )
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
