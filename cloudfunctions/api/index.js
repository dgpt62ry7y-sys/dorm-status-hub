const crypto = require('node:crypto')
const cloudbase = require('@cloudbase/node-sdk')

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV })
const db = app.database()

const ROOM_CAPACITY = 4
const VALID_STATUSES = new Set(['sleep', 'normal', 'focus', 'away'])
const TIMED_STATUSES = new Set(['sleep', 'focus'])
const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const COLLECTIONS = ['rooms', 'members', 'statuses']

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

function normalizeInviteCode(value) {
  return String(value ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
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
    .limit(ROOM_CAPACITY)
    .get()
  return result.data
}

async function getStatuses(roomId) {
  const result = await db
    .collection('statuses')
    .where({ roomId })
    .limit(ROOM_CAPACITY)
    .get()
  return result.data
}

async function findMemberByToken(token) {
  if (!token || typeof token !== 'string') return null
  const result = await db
    .collection('members')
    .where({
      memberTokenHash: hashToken(token),
      active: true,
    })
    .limit(1)
    .get()
  return result.data[0] ?? null
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

async function buildState(member) {
  const room = await getRoom(member.roomId)
  if (!room || room.closed) return null

  const [members, rawStatuses] = await Promise.all([
    getActiveMembers(member.roomId),
    getStatuses(member.roomId),
  ])
  const statuses = await expireStatuses(rawStatuses)
  await db.collection('members').doc(member._id).update({
    lastSeenAt: nowIso(),
  })

  return {
    room: {
      id: room._id,
      name: room.name,
      inviteCode: room.inviteCode,
      ownerId: room.ownerId,
      capacity: room.capacity || ROOM_CAPACITY,
      memberCount: members.length,
    },
    currentMemberId: member._id,
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

async function insertMember(transaction, { roomId, nickname, role }) {
  const memberToken = randomToken()
  const joinedAt = nowIso()
  const memberResult = await transaction.collection('members').add({
    roomId,
    nickname,
    role,
    memberTokenHash: hashToken(memberToken),
    active: true,
    defaultStatus: 'normal',
    joinedAt,
    lastSeenAt: joinedAt,
  })
  const memberId = insertedId(memberResult)

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
  if (!nickname) return fail('NICKNAME_REQUIRED', '请输入昵称')
  if (!roomName) return fail('ROOM_NAME_REQUIRED', '请输入宿舍名称')

  const created = await db.runTransaction(async (transaction) => {
    const rooms = transaction.collection('rooms')
    const inviteCode = await generateUniqueCode(rooms)
    const createdAt = nowIso()
    const roomResult = await rooms.add({
      name: roomName,
      inviteCode,
      inviteCodeHash: hashToken(inviteCode),
      ownerId: '',
      capacity: ROOM_CAPACITY,
      createdAt,
      updatedAt: createdAt,
      closed: false,
    })
    const roomId = insertedId(roomResult)
    const member = await insertMember(transaction, {
      roomId,
      nickname,
      role: 'owner',
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
    state: await buildState(member),
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
        .limit(ROOM_CAPACITY)
        .get()
      if (membersResult.data.length >= (room.capacity || ROOM_CAPACITY)) {
        throw new Error('ROOM_FULL')
      }
      if (membersResult.data.some((item) => item.nickname === nickname)) {
        throw new Error('NICKNAME_TAKEN')
      }

      const member = await insertMember(transaction, {
        roomId: room._id,
        nickname,
        role: 'member',
      })
      return member
    })

    const member = await getDocument('members', joined.memberId)
    return ok({
      memberToken: joined.memberToken,
      state: await buildState(member),
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

async function handleUpdateStatus(event, member) {
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

  return ok(await buildState(member))
}

async function handleUpdateProfile(event, member) {
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
    }),
  )
}

async function handleRegenerateInvite(member) {
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
    state: await buildState({ ...member, roomId: member.roomId }),
  })
}

async function handleRemoveMember(event, member) {
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

  return ok(await buildState(member))
}

async function handleLeaveRoom(member) {
  await db.runTransaction(async (transaction) => {
    const rooms = transaction.collection('rooms')
    const members = transaction.collection('members')
    const roomResult = await rooms.doc(member.roomId).get()
    const room = roomResult.data?.[0]
    if (!room) throw new Error('ROOM_NOT_FOUND')

    await members.doc(member._id).update({
      active: false,
      leftAt: nowIso(),
    })

    if (room.ownerId === member._id) {
      const nextResult = await members
        .where({ roomId: member.roomId, active: true })
        .limit(ROOM_CAPACITY)
        .get()
      const nextOwner = nextResult.data.find((item) => item._id !== member._id)
      if (nextOwner) {
        await members.doc(nextOwner._id).update({ role: 'owner' })
        await rooms.doc(member.roomId).update({
          ownerId: nextOwner._id,
          updatedAt: nowIso(),
        })
      } else {
        await rooms.doc(member.roomId).update({
          closed: true,
          updatedAt: nowIso(),
        })
      }
    }
  })

  return ok({ left: true })
}

async function dispatch(event = {}) {
  try {
    await ensureCollections()

    if (event.action === 'createRoom') return await handleCreateRoom(event)
    if (event.action === 'joinRoom') return await handleJoinRoom(event)

    const member = await findMemberByToken(event.memberToken)
    if (!member) return fail('AUTH_REQUIRED', '登录状态已失效，请重新加入宿舍')

    if (event.action === 'getState') return ok(await buildState(member))
    if (event.action === 'updateStatus') return await handleUpdateStatus(event, member)
    if (event.action === 'updateProfile') return await handleUpdateProfile(event, member)
    if (event.action === 'regenerateInvite') return await handleRegenerateInvite(member)
    if (event.action === 'removeMember') return await handleRemoveMember(event, member)
    if (event.action === 'leaveRoom') return await handleLeaveRoom(member)

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
