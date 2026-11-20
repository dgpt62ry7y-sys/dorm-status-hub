const crypto = require('node:crypto')
const cloudbase = require('@cloudbase/node-sdk')

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV })
const db = app.database()

const DEFAULT_ROOM_CAPACITY = 4
const MAX_ROOM_CAPACITY = 6
const VALID_ROOM_CAPACITIES = new Set([4, 6])
const MAX_DEVICES = 5
const DEVICE_LINK_TTL_MS = 5 * 60 * 1000
const VALID_STATUSES = new Set(['sleep', 'normal', 'focus', 'away'])
const TIMED_STATUSES = new Set(['sleep', 'focus'])
const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const COLLECTIONS = ['rooms', 'members', 'statuses', 'deviceSessions', 'deviceLinks']

let collectionsReady

function ok(data) {
  return { ok: true, data }
}

function fail(code, message) {
  return { ok: false, error: { code, message } }
}

function nowIso() {
  return new Date().toISOString()
}

function cleanText(value, maxLength) {
  return String(value ?? '').trim().slice(0, maxLength)
}

function insertedId(result) {
  return result.id || result.ids?.[0] || ''
}

function randomToken() {
  return crypto.randomBytes(32).toString('base64url')
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

function createInviteCode(length = 6) {
  let code = ''
  for (let index = 0; index < length; index += 1) {
    code += INVITE_ALPHABET[crypto.randomInt(0, INVITE_ALPHABET.length)]
  }
  return code
}

function createRecoveryCode() {
  return createInviteCode(20)
}

function createDeviceLinkCode() {
  return createInviteCode(8)
}

function normalizeInviteCode(value) {
  return String(value ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
}

function normalizeSecret(value) {
  return String(value ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
}

function deviceLabel(value) {
  return cleanText(value, 40) || '浏览器设备'
}

async function ensureCollections() {
  if (!collectionsReady) {
    collectionsReady = Promise.all(
      COLLECTIONS.map(async (name) => {
        try {
          await db.createCollection(name)
        } catch (error) {
          const message = String(error?.message || '').toLowerCase()
          if (
            !message.includes('exist') &&
            !message.includes('already') &&
            error?.code !== 'DATABASE_COLLECTION_EXIST'
          ) {
            throw error
          }
        }
      }),
    )
  }
  await collectionsReady
}

async function getDocument(collectionName, id) {
  const result = await db.collection(collectionName).doc(id).get()
  return result.data?.[0] ?? null
}

async function getRoom(roomId) {
  return getDocument('rooms', roomId)
}

async function getActiveMembers(roomId) {
  const result = await db
    .collection('members')
    .where({ roomId, active: true })
    .limit(MAX_ROOM_CAPACITY)
    .get()
  return result.data
}

async function getStatuses(roomId) {
  const result = await db
    .collection('statuses')
    .where({ roomId })
    .limit(MAX_ROOM_CAPACITY)
    .get()
  return result.data
}

async function insertDeviceSession(collection, { memberId, roomId, memberToken, label }) {
  const createdAt = nowIso()
  const result = await collection.add({
    memberId,
    roomId,
    tokenHash: hashToken(memberToken),
    label,
    active: true,
    createdAt,
    lastSeenAt: createdAt,
    revokedAt: null,
  })
  return insertedId(result)
}

async function getActiveDeviceSessions(memberId, limit = MAX_DEVICES + 1) {
  const result = await db
    .collection('deviceSessions')
    .where({ memberId, active: true })
    .limit(limit)
    .get()
  return result.data
}

async function revokeMemberSessions(memberId) {
  const sessions = await getActiveDeviceSessions(memberId)
  const revokedAt = nowIso()
  await Promise.all(
    sessions.map((session) =>
      db.collection('deviceSessions').doc(session._id).update({
        active: false,
        revokedAt,
      }),
    ),
  )
}

async function revokeMemberDeviceLinks(memberId) {
  const result = await db
    .collection('deviceLinks')
    .where({ memberId })
    .limit(10)
    .get()
  const revokedAt = nowIso()
  await Promise.all(
    result.data
      .filter((link) => !link.revokedAt && !link.usedAt)
      .map((link) =>
        db.collection('deviceLinks').doc(link._id).update({
          active: false,
          revokedAt,
        }),
      ),
  )
}

async function findAuthenticatedContext(token) {
  if (!token || typeof token !== 'string') return null
  const tokenHash = hashToken(token)
  const sessionResult = await db
    .collection('deviceSessions')
    .where({
      tokenHash,
      active: true,
    })
    .limit(1)
    .get()
  const session = sessionResult.data[0]

  if (session) {
    const member = await getDocument('members', session.memberId)
    if (!member || !member.active) {
      await db.collection('deviceSessions').doc(session._id).update({
        active: false,
        revokedAt: nowIso(),
      })
      return null
    }
    await db.collection('deviceSessions').doc(session._id).update({
      lastSeenAt: nowIso(),
    })
    return { member, session }
  }

  const legacyResult = await db
    .collection('members')
    .where({
      memberTokenHash: tokenHash,
      active: true,
    })
    .limit(1)
    .get()
  const legacyMember = legacyResult.data[0]
  if (!legacyMember) return null

  const sessionId = await insertDeviceSession(db.collection('deviceSessions'), {
    memberId: legacyMember._id,
    roomId: legacyMember.roomId,
    memberToken: token,
    label: '已迁移设备',
  })
  await db.collection('members').doc(legacyMember._id).update({
    memberTokenHash: null,
    legacySessionMigratedAt: nowIso(),
  })

  return {
    member: legacyMember,
    session: {
      _id: sessionId,
      memberId: legacyMember._id,
      roomId: legacyMember.roomId,
      active: true,
    },
  }
}

async function expireStatuses(statuses) {
  const now = Date.now()
  const normalized = []

  for (const status of statuses) {
    const expired =
      TIMED_STATUSES.has(status.status) &&
      status.endAt &&
      Number.isFinite(Date.parse(status.endAt)) &&
      Date.parse(status.endAt) <= now

    if (!expired) {
      normalized.push(status)
      continue
    }

    const next = {
      ...status,
      status: 'normal',
      endAt: null,
      note: '预计时间已结束',
      updatedAt: nowIso(),
    }
    await db.collection('statuses').doc(status._id).update({
      status: next.status,
      endAt: next.endAt,
      note: next.note,
      updatedAt: next.updatedAt,
    })
    normalized.push(next)
  }

  return normalized
}

async function takeCapacityNotice(member, room) {
  const notice = room.capacityNotice
  if (!notice?.id || notice.changedBy === member._id) return null

  const deliveredAt = nowIso()
  const result = await db
    .collection('members')
    .where({
      _id: member._id,
      capacityNoticePendingId: notice.id,
    })
    .update({
      capacityNoticePendingId: null,
      capacityNoticeDeliveredId: notice.id,
      capacityNoticeDeliveredAt: deliveredAt,
    })
  return (result.updated || 0) === 1 ? notice : null
}

async function buildState(member, currentDeviceId = '', claimCapacityNotice = false) {
  const room = await getRoom(member.roomId)
  if (!room || room.closed) return null

  const capacityNotice = claimCapacityNotice
    ? await takeCapacityNotice(member, room)
    : null
  const [members, rawStatuses] = await Promise.all([
    getActiveMembers(member.roomId),
    getStatuses(member.roomId),
  ])
  const statuses = await expireStatuses(rawStatuses)
  const seenAt = nowIso()
  const seenUpdates = [
    db.collection('members').doc(member._id).update({
      lastSeenAt: seenAt,
    }),
  ]
  if (currentDeviceId) {
    seenUpdates.push(
      db.collection('deviceSessions').doc(currentDeviceId).update({
        lastSeenAt: seenAt,
      }),
    )
  }
  await Promise.all(seenUpdates)

  return {
    room: {
      id: room._id,
      name: room.name,
      inviteCode: room.inviteCode,
      ownerId: room.ownerId,
      capacity: VALID_ROOM_CAPACITIES.has(room.capacity)
        ? room.capacity
        : DEFAULT_ROOM_CAPACITY,
      memberCount: members.length,
    },
    currentMemberId: member._id,
    currentDeviceId,
    capacityNotice,
    members: members.map((item) => ({
      id: item._id,
      nickname: item.nickname,
      role: item.role,
      joinedAt: item.joinedAt,
    })),
    statuses: statuses.map((item) => ({
      memberId: item.memberId,
      status: item.status,
      note: item.note || '',
      updatedAt: item.updatedAt,
      endAt: item.endAt || null,
    })),
    preferences: {
      defaultStatus: VALID_STATUSES.has(member.defaultStatus)
        ? member.defaultStatus
        : 'normal',
    },
    syncedAt: nowIso(),
  }
}

async function generateUniqueCode(collection = db.collection('rooms')) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const code = createInviteCode()
    const result = await collection.where({ inviteCode: code }).limit(1).get()
    if (result.data.length === 0) return code
  }
  throw new Error('INVITE_CODE_GENERATION_FAILED')
}

async function insertMember(transaction, { roomId, nickname, role, label }) {
  const memberToken = randomToken()
  const recoveryCode = createRecoveryCode()
  const joinedAt = nowIso()
  const memberResult = await transaction.collection('members').add({
    roomId,
    nickname,
    role,
    active: true,
    defaultStatus: 'normal',
    joinedAt,
    lastSeenAt: joinedAt,
    recoveryCodeHash: hashToken(recoveryCode),
    recoveryCodeUpdatedAt: joinedAt,
  })
  const memberId = insertedId(memberResult)
  const sessionId = await insertDeviceSession(transaction.collection('deviceSessions'), {
    memberId,
    roomId,
    memberToken,
    label: deviceLabel(label),
  })

  await transaction.collection('statuses').add({
    memberId,
    roomId,
    status: 'normal',
    note: '',
    updatedAt: joinedAt,
    endAt: null,
  })

  return {
    memberId,
    memberToken,
    recoveryCode,
    sessionId,
    nickname,
    role,
    joinedAt,
    defaultStatus: 'normal',
    roomId,
  }
}

async function handleCreateRoom(event) {
  const nickname = cleanText(event.nickname, 12)
  const roomName = cleanText(event.roomName || '我的宿舍', 20)
  const capacity = Number(event.capacity || DEFAULT_ROOM_CAPACITY)
  if (!nickname) return fail('NICKNAME_REQUIRED', '请输入昵称')
  if (!roomName) return fail('ROOM_NAME_REQUIRED', '请输入宿舍名称')
  if (!VALID_ROOM_CAPACITIES.has(capacity)) {
    return fail('INVALID_CAPACITY', '宿舍容量只能是四人寝或六人寝')
  }

  const created = await db.runTransaction(async (transaction) => {
    const rooms = transaction.collection('rooms')
    const inviteCode = await generateUniqueCode(rooms)
    const createdAt = nowIso()
    const roomResult = await rooms.add({
      name: roomName,
      inviteCode,
      inviteCodeHash: hashToken(inviteCode),
      ownerId: '',
      capacity,
      createdAt,
      updatedAt: createdAt,
      closed: false,
    })
    const roomId = insertedId(roomResult)
    const member = await insertMember(transaction, {
      roomId,
      nickname,
      role: 'owner',
      label: event.deviceLabel,
    })
    await rooms.doc(roomId).update({
      ownerId: member.memberId,
      updatedAt: nowIso(),
    })
    return { roomId, member }
  })

  const member = await getDocument('members', created.member.memberId)
  return ok({
    memberToken: created.member.memberToken,
    recoveryCode: created.member.recoveryCode,
    state: await buildState(member, created.member.sessionId),
  })
}

async function handleJoinRoom(event) {
  const nickname = cleanText(event.nickname, 12)
  const inviteCode = normalizeInviteCode(event.inviteCode)
  if (!nickname) return fail('NICKNAME_REQUIRED', '请输入昵称')
  if (!inviteCode) return fail('INVITE_REQUIRED', '请输入邀请码')

  try {
    const joined = await db.runTransaction(async (transaction) => {
      const roomResult = await transaction
        .collection('rooms')
        .where({ inviteCode, closed: false })
        .limit(1)
        .get()
      const room = roomResult.data[0]
      if (!room) throw new Error('ROOM_NOT_FOUND')

      const membersResult = await transaction
        .collection('members')
        .where({ roomId: room._id, active: true })
        .limit(MAX_ROOM_CAPACITY)
        .get()
      const roomCapacity = VALID_ROOM_CAPACITIES.has(room.capacity)
        ? room.capacity
        : DEFAULT_ROOM_CAPACITY
      if (membersResult.data.length >= roomCapacity) {
        throw new Error('ROOM_FULL')
      }
      if (membersResult.data.some((item) => item.nickname === nickname)) {
        throw new Error('NICKNAME_TAKEN')
      }

      const member = await insertMember(transaction, {
        roomId: room._id,
        nickname,
        role: 'member',
        label: event.deviceLabel,
      })
      return member
    })

    const member = await getDocument('members', joined.memberId)
    return ok({
      memberToken: joined.memberToken,
      recoveryCode: joined.recoveryCode,
      state: await buildState(member, joined.sessionId),
    })
  } catch (error) {
    if (error.message === 'ROOM_NOT_FOUND') {
      return fail('ROOM_NOT_FOUND', '邀请码无效或已失效')
    }
    if (error.message === 'ROOM_FULL') return fail('ROOM_FULL', '宿舍人数已满')
    if (error.message === 'NICKNAME_TAKEN') {
      return fail('NICKNAME_TAKEN', '这个昵称已经被使用')
    }
    throw error
  }
}

async function handleCreateDeviceLink(member) {
  const activeSessions = await getActiveDeviceSessions(member._id)
  if (activeSessions.length >= MAX_DEVICES) {
    return fail('DEVICE_LIMIT_REACHED', '账号最多绑定 5 台设备，请先移除其他设备')
  }

  const code = createDeviceLinkCode()
  const codeHash = hashToken(code)
  const createdAt = nowIso()
  const expiresAt = new Date(Date.now() + DEVICE_LINK_TTL_MS).toISOString()

  await db.runTransaction(async (transaction) => {
    const links = await transaction
      .collection('deviceLinks')
      .where({ memberId: member._id, active: true })
      .limit(10)
      .get()
    for (const link of links.data) {
      await transaction.collection('deviceLinks').doc(link._id).update({
        active: false,
        revokedAt: createdAt,
      })
    }
    await transaction.collection('deviceLinks').doc(codeHash).set({
      memberId: member._id,
      roomId: member.roomId,
      codeHash,
      active: true,
      createdAt,
      expiresAt,
      usedAt: null,
      revokedAt: null,
    })
  })

  return ok({ code, expiresAt })
}

async function handleClaimDeviceLink(event) {
  const code = normalizeSecret(event.code)
  if (code.length !== 8) {
    return fail('DEVICE_LINK_INVALID', '绑定码无效，请重新输入')
  }

  const codeHash = hashToken(code)
  const link = await getDocument('deviceLinks', codeHash)
  if (!link) return fail('DEVICE_LINK_INVALID', '绑定码无效，请重新输入')
  if (link.usedAt) {
    return fail('DEVICE_LINK_USED', '绑定码已经使用过，请重新生成')
  }
  if (link.revokedAt || link.active === false) {
    return fail('DEVICE_LINK_INVALID', '绑定码无效，请重新输入')
  }
  if (!link.expiresAt || Date.parse(link.expiresAt) <= Date.now()) {
    await db.collection('deviceLinks').doc(codeHash).update({
      active: false,
      revokedAt: nowIso(),
    })
    return fail('DEVICE_LINK_EXPIRED', '绑定码已过期，请在原设备重新生成')
  }

  const member = await getDocument('members', link.memberId)
  if (!member || !member.active) {
    return fail('DEVICE_LINK_INVALID', '绑定码无效，请重新输入')
  }
  const room = await getRoom(member.roomId)
  if (!room || room.closed) {
    return fail('DEVICE_LINK_INVALID', '绑定码无效，请重新输入')
  }

  const sessions = await getActiveDeviceSessions(member._id)
  if (sessions.length >= MAX_DEVICES) {
    return fail('DEVICE_LIMIT_REACHED', '账号已经绑定 5 台设备')
  }

  const usedAt = nowIso()
  const claimResult = await db
    .collection('deviceLinks')
    .where({ _id: codeHash, active: true, usedAt: null })
    .update({
      active: false,
      usedAt,
    })
  if ((claimResult.updated || 0) !== 1) {
    return fail('DEVICE_LINK_USED', '绑定码已经使用过，请重新生成')
  }

  const memberToken = randomToken()
  const sessionId = await insertDeviceSession(db.collection('deviceSessions'), {
    memberId: member._id,
    roomId: member.roomId,
    memberToken,
    label: deviceLabel(event.deviceLabel),
  })
  await db.collection('deviceLinks').doc(codeHash).update({
    usedBySessionId: sessionId,
  })

  const state = await buildState(member, sessionId, true)
  if (!state) return fail('DEVICE_LINK_INVALID', '绑定码已失效')
  return ok({ memberToken, state })
}

async function handleRecoverAccount(event) {
  const code = normalizeSecret(event.recoveryCode)
  if (code.length !== 20) {
    return fail('RECOVERY_CODE_INVALID', '恢复码无效，请检查后重试')
  }

  const memberResult = await db
    .collection('members')
    .where({ recoveryCodeHash: hashToken(code), active: true })
    .limit(1)
    .get()
  const member = memberResult.data[0]
  if (!member) {
    return fail('RECOVERY_CODE_INVALID', '恢复码无效，请检查后重试')
  }

  const room = await getRoom(member.roomId)
  if (!room || room.closed) {
    return fail('RECOVERY_CODE_INVALID', '恢复码无效，请检查后重试')
  }

  const sessions = await getActiveDeviceSessions(member._id)
  if (sessions.length >= MAX_DEVICES) {
    return fail('DEVICE_LIMIT_REACHED', '账号已经绑定 5 台设备')
  }

  const memberToken = randomToken()
  const sessionId = await insertDeviceSession(db.collection('deviceSessions'), {
    memberId: member._id,
    roomId: member.roomId,
    memberToken,
    label: deviceLabel(event.deviceLabel),
  })
  const state = await buildState(member, sessionId, true)
  if (!state) return fail('RECOVERY_CODE_INVALID', '恢复码已失效')
  return ok({ memberToken, state })
}

async function listMemberDevices(memberId, currentDeviceId) {
  const sessions = await getActiveDeviceSessions(memberId)
  return sessions
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    .map((session) => ({
      id: session._id,
      label: session.label || '浏览器设备',
      createdAt: session.createdAt,
      lastSeenAt: session.lastSeenAt,
      isCurrent: session._id === currentDeviceId,
    }))
}

async function handleListDevices(member, session) {
  return ok({
    currentDeviceId: session._id,
    devices: await listMemberDevices(member._id, session._id),
  })
}

async function handleRevokeDevice(event, member, session) {
  const targetId = cleanText(event.deviceId, 100)
  if (!targetId) return fail('DEVICE_SESSION_REVOKED', '设备不存在')

  const target = await getDocument('deviceSessions', targetId)
  if (!target || target.memberId !== member._id || !target.active) {
    return fail('DEVICE_SESSION_REVOKED', '设备已经退出')
  }

  await db.collection('deviceSessions').doc(targetId).update({
    active: false,
    revokedAt: nowIso(),
  })

  return ok({
    currentDeviceId: session._id,
    revokedCurrent: targetId === session._id,
    devices: await listMemberDevices(member._id, session._id),
  })
}

async function handleRotateRecoveryCode(member) {
  const recoveryCode = createRecoveryCode()
  await db.collection('members').doc(member._id).update({
    recoveryCodeHash: hashToken(recoveryCode),
    recoveryCodeUpdatedAt: nowIso(),
  })
  return ok({ recoveryCode })
}

async function handleUpdateStatus(event, member, currentDeviceId) {
  if (!VALID_STATUSES.has(event.status)) {
    return fail('INVALID_STATUS', '状态无效')
  }
  if (event.status === 'sleep' && !event.endAt) {
    return fail('END_TIME_REQUIRED', '睡觉中需要设置预计起床时间')
  }

  let endAt = null
  if (TIMED_STATUSES.has(event.status) && event.endAt) {
    const parsed = Date.parse(event.endAt)
    if (!Number.isFinite(parsed) || parsed <= Date.now()) {
      return fail('INVALID_END_TIME', '预计结束时间必须晚于现在')
    }
    endAt = new Date(parsed).toISOString()
  }

  const statusResult = await db
    .collection('statuses')
    .where({ memberId: member._id, roomId: member.roomId })
    .limit(1)
    .get()
  const status = {
    memberId: member._id,
    roomId: member.roomId,
    status: event.status,
    note: cleanText(event.note, 30),
    endAt,
    updatedAt: nowIso(),
  }

  if (statusResult.data[0]) {
    await db.collection('statuses').doc(statusResult.data[0]._id).update(status)
  } else {
    await db.collection('statuses').add(status)
  }

  return ok(await buildState(member, currentDeviceId))
}

async function handleUpdateProfile(event, member, currentDeviceId) {
  const nickname = cleanText(event.nickname, 12)
  const defaultStatus = VALID_STATUSES.has(event.defaultStatus)
    ? event.defaultStatus
    : member.defaultStatus || 'normal'
  if (!nickname) return fail('NICKNAME_REQUIRED', '请输入昵称')

  const members = await getActiveMembers(member.roomId)
  if (members.some((item) => item._id !== member._id && item.nickname === nickname)) {
    return fail('NICKNAME_TAKEN', '这个昵称已经被使用')
  }

  await db.collection('members').doc(member._id).update({
    nickname,
    defaultStatus,
    lastSeenAt: nowIso(),
  })

  return ok(
    await buildState({
      ...member,
      nickname,
      defaultStatus,
    }, currentDeviceId),
  )
}

async function handleRegenerateInvite(member, currentDeviceId) {
  const room = await getRoom(member.roomId)
  if (!room || room.ownerId !== member._id) {
    return fail('ONLY_OWNER', '只有宿舍创建者可以重新生成邀请码')
  }

  const inviteCode = await db.runTransaction(async (transaction) => {
    const rooms = transaction.collection('rooms')
    const code = await generateUniqueCode(rooms)
    await rooms.doc(member.roomId).update({
      inviteCode: code,
      inviteCodeHash: hashToken(code),
      updatedAt: nowIso(),
    })
    return code
  })

  return ok({
    inviteCode,
    state: await buildState({ ...member, roomId: member.roomId }, currentDeviceId),
  })
}

async function handleUpdateRoomCapacity(event, member, currentDeviceId) {
  const room = await getRoom(member.roomId)
  if (!room || room.closed) return fail('ROOM_NOT_FOUND', '宿舍不存在或已经关闭')
  if (room.ownerId !== member._id) {
    return fail('ONLY_OWNER', '只有房主可以修改宿舍房型')
  }

  const capacity = Number(event.capacity)
  if (!VALID_ROOM_CAPACITIES.has(capacity)) {
    return fail('INVALID_CAPACITY', '宿舍容量只能是四人寝或六人寝')
  }

  const currentCapacity = VALID_ROOM_CAPACITIES.has(room.capacity)
    ? room.capacity
    : DEFAULT_ROOM_CAPACITY
  if (capacity === currentCapacity) {
    return ok(await buildState(member, currentDeviceId))
  }

  const members = await getActiveMembers(member.roomId)
  if (capacity === 4 && members.length > 4) {
    return fail('CAPACITY_LIMIT', '请先将当前成员移除到 4 人或更少')
  }

  const changedAt = nowIso()
  const notice = {
    id: crypto.randomUUID(),
    from: currentCapacity,
    to: capacity,
    changedAt,
    changedBy: member._id,
  }
  await db.collection('rooms').doc(member.roomId).update({
    capacity,
    capacityNotice: notice,
    updatedAt: changedAt,
  })

  await Promise.all(
    members
      .filter((item) => item._id !== member._id)
      .map((item) =>
        db.collection('members').doc(item._id).update({
          capacityNoticePendingId: notice.id,
        }),
      ),
  )

  return ok(await buildState(member, currentDeviceId))
}

async function handleAcknowledgeCapacityNotice(event, member) {
  const noticeId = cleanText(event.noticeId, 100)
  if (!noticeId) return fail('INVALID_NOTICE', '通知无效')

  await db
    .collection('members')
    .where({
      _id: member._id,
      capacityNoticeDeliveredId: noticeId,
    })
    .update({
      capacityNoticeAcknowledgedAt: nowIso(),
    })

  return ok({ acknowledged: true })
}

async function handleRemoveMember(event, member, currentDeviceId) {
  const room = await getRoom(member.roomId)
  if (!room || room.ownerId !== member._id) {
    return fail('ONLY_OWNER', '只有宿舍创建者可以移除成员')
  }
  const targetMemberId = cleanText(event.memberId, 100)
  if (!targetMemberId || targetMemberId === member._id) {
    return fail('INVALID_MEMBER', '不能移除自己')
  }

  const target = await getDocument('members', targetMemberId)
  if (!target || target.roomId !== member.roomId || !target.active) {
    return fail('MEMBER_NOT_FOUND', '成员不存在')
  }
  if (target.role === 'owner') return fail('INVALID_MEMBER', '不能移除创建者')

  await db.collection('members').doc(targetMemberId).update({
    active: false,
    removedAt: nowIso(),
    removedBy: member._id,
  })
  await Promise.all([
    revokeMemberSessions(targetMemberId),
    revokeMemberDeviceLinks(targetMemberId),
  ])
  const statusResult = await db
    .collection('statuses')
    .where({ memberId: targetMemberId })
    .limit(1)
    .get()
  if (statusResult.data[0]) {
    await db.collection('statuses').doc(statusResult.data[0]._id).update({
      status: 'normal',
      note: '',
      endAt: null,
      updatedAt: nowIso(),
    })
  }

  return ok(await buildState(member, currentDeviceId))
}

async function handleLeaveRoom(member) {
  const room = await getRoom(member.roomId)
  if (!room) throw new Error('ROOM_NOT_FOUND')

  await db.collection('members').doc(member._id).update({
    active: false,
    leftAt: nowIso(),
  })

  if (room.ownerId === member._id) {
    const nextMembers = await getActiveMembers(member.roomId)
    const nextOwner = nextMembers.find((item) => item._id !== member._id)
    if (nextOwner) {
      await db.collection('members').doc(nextOwner._id).update({ role: 'owner' })
      await db.collection('rooms').doc(member.roomId).update({
        ownerId: nextOwner._id,
        updatedAt: nowIso(),
      })
    } else {
      await db.collection('rooms').doc(member.roomId).update({
        closed: true,
        updatedAt: nowIso(),
      })
    }
  }

  await Promise.all([
    revokeMemberSessions(member._id),
    revokeMemberDeviceLinks(member._id),
  ])
  return ok({ left: true })
}

async function dispatch(event = {}) {
  try {
    await ensureCollections()

    if (event.action === 'createRoom') return await handleCreateRoom(event)
    if (event.action === 'joinRoom') return await handleJoinRoom(event)
    if (event.action === 'claimDeviceLink') return await handleClaimDeviceLink(event)
    if (event.action === 'recoverAccount') return await handleRecoverAccount(event)

    const context = await findAuthenticatedContext(event.memberToken)
    if (!context) return fail('AUTH_REQUIRED', '登录状态已失效，请重新绑定或恢复账号')
    const { member, session } = context

    if (event.action === 'getState') {
      const state = await buildState(
        member,
        session._id,
        Boolean(event.claimCapacityNotice),
      )
      return state ? ok(state) : fail('ROOM_NOT_FOUND', '宿舍不存在或已经关闭')
    }
    if (event.action === 'updateStatus') {
      return await handleUpdateStatus(event, member, session._id)
    }
    if (event.action === 'updateProfile') {
      return await handleUpdateProfile(event, member, session._id)
    }
    if (event.action === 'regenerateInvite') {
      return await handleRegenerateInvite(member, session._id)
    }
    if (event.action === 'updateRoomCapacity') {
      return await handleUpdateRoomCapacity(event, member, session._id)
    }
    if (event.action === 'acknowledgeCapacityNotice') {
      return await handleAcknowledgeCapacityNotice(event, member)
    }
    if (event.action === 'removeMember') {
      return await handleRemoveMember(event, member, session._id)
    }
    if (event.action === 'leaveRoom') return await handleLeaveRoom(member)
    if (event.action === 'createDeviceLink') return await handleCreateDeviceLink(member)
    if (event.action === 'listDevices') return await handleListDevices(member, session)
    if (event.action === 'revokeDevice') {
      return await handleRevokeDevice(event, member, session)
    }
    if (event.action === 'rotateRecoveryCode') {
      return await handleRotateRecoveryCode(member)
    }
    return fail('UNKNOWN_ACTION', '未知操作')
  } catch (error) {
    console.error(error)
    if (error.message === 'ROOM_NOT_FOUND') {
      return fail('ROOM_NOT_FOUND', '宿舍不存在或已经关闭')
    }
    return fail('INTERNAL_ERROR', '服务暂时不可用，请稍后重试')
  }
}

function parseHttpPayload(event) {
  if (!event.body) return {}
  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : event.body
  return JSON.parse(rawBody)
}

exports.main = async (event = {}) => {
  if (!event.httpMethod && !event.requestContext?.http) {
    return dispatch(event)
  }

  const responseHeaders = {
    'content-type': 'application/json; charset=utf-8',
  }

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: responseHeaders, body: '' }
  }

  try {
    const payload = parseHttpPayload(event)
    const result = await dispatch(payload)
    return {
      statusCode: 200,
      headers: responseHeaders,
      body: JSON.stringify(result),
    }
  } catch (error) {
    console.error(error)
    return {
      statusCode: 400,
      headers: responseHeaders,
      body: JSON.stringify(fail('INVALID_REQUEST', '请求格式不正确')),
    }
  }
}
