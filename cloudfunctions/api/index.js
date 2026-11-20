const crypto = require('node:crypto')
const cloudbase = require('@cloudbase/node-sdk')
const releases = require('./releases.cjs')

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV })
const db = app.database()

const DEFAULT_ROOM_CAPACITY = 4
const MAX_ROOM_CAPACITY = 6
const VALID_ROOM_CAPACITIES = new Set([4, 6])
const MAX_DEVICES = 5
const DEVICE_LINK_TTL_MS = 5 * 60 * 1000
const SECURITY_WINDOW_MS = 15 * 60 * 1000
const MAX_SECURITY_ATTEMPTS = 5
const EXISTING_ROOM_VERIFY_MS = 12 * 60 * 60 * 1000
const EXISTING_ROOM_FALLBACK_MS = 3 * 24 * 60 * 60 * 1000
const NTFY_DEFAULT_SERVER = 'https://ntfy.sh'
const NTFY_TOPIC_PREFIX = 'dormsync-'
const NTFY_TIMEOUT_MS = 3_000
const NTFY_TEST_COOLDOWN_MS = 60_000
const NOTIFICATION_TITLE = 'DormSync · 宿舍状态更新'
const NOTIFICATION_TEST_TITLE = 'DormSync · 宿舍通知测试'
const VALID_STATUSES = new Set(['sleep', 'normal', 'focus', 'away'])
const TIMED_STATUSES = new Set(['sleep', 'focus', 'away'])
const REQUIRED_TIME_STATUSES = new Set(['sleep', 'away'])
const LEGACY_EXPIRED_NOTE = '预计时间已结束'
const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const COLLECTIONS = [
  'rooms',
  'members',
  'statuses',
  'deviceSessions',
  'deviceLinks',
  'releaseClaims',
  'securityAttempts',
  'systemSettings',
]
const CURRENT_RELEASE_VERSION = releases.at(-1).version

let collectionsReady
let verificationRolloutPromise

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

function versionParts(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(version ?? ''))
  return match ? match.slice(1).map(Number) : null
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

function deviceLabel(value) {
  return cleanText(value, 40) || '浏览器设备'
}

const NTFY_STATUS_LABELS = {
  sleep: '睡觉中',
  normal: '正常活动',
  focus: '专注学习',
  away: '外出',
}

function ntfyServerUrl() {
  const value = String(process.env.DORMSYNC_NTFY_SERVER || NTFY_DEFAULT_SERVER)
    .trim()
    .replace(/\/+$/, '')
  try {
    const parsed = new URL(value)
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('invalid')
    return value
  } catch {
    console.error('Invalid ntfy server configuration')
    return NTFY_DEFAULT_SERVER
  }
}

function ntfyPublicServerUrl() {
  const value = String(
    process.env.DORMSYNC_NTFY_PUBLIC_URL || ntfyServerUrl(),
  )
    .trim()
    .replace(/\/+$/, '')
  try {
    const parsed = new URL(value)
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('invalid')
    return value
  } catch {
    console.error('Invalid public ntfy server configuration')
    return NTFY_DEFAULT_SERVER
  }
}

function createNtfyTopic() {
  return `${NTFY_TOPIC_PREFIX}${crypto.randomBytes(32).toString('base64url')}`
}

function validNtfyTopic(topic) {
  return (
    typeof topic === 'string' &&
    topic.length > NTFY_TOPIC_PREFIX.length &&
    topic.length <= 64 &&
    /^[A-Za-z0-9_-]+$/.test(topic)
  )
}

function encodeNtfyHeader(value) {
  return `=?UTF-8?B?${Buffer.from(String(value), 'utf8').toString('base64')}?=`
}

function beijingDateParts(value) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    hourCycle: 'h23',
  }).formatToParts(new Date(value))
  return Object.fromEntries(parts.map((part) => [part.type, part.value]))
}

function notificationTime(value, reference = new Date()) {
  const target = new Date(value)
  if (!Number.isFinite(target.getTime())) return ''
  const targetParts = beijingDateParts(target)
  const referenceParts = beijingDateParts(reference)
  const targetDate = Date.UTC(
    Number(targetParts.year),
    Number(targetParts.month) - 1,
    Number(targetParts.day),
  )
  const referenceDate = Date.UTC(
    Number(referenceParts.year),
    Number(referenceParts.month) - 1,
    Number(referenceParts.day),
  )
  const difference = Math.round((targetDate - referenceDate) / 86_400_000)
  const clock = `${targetParts.hour}:${targetParts.minute}`
  if (difference === 0) return clock
  if (difference === 1) return `明天 ${clock}`
  return `${Number(targetParts.month)}月${Number(targetParts.day)}日 ${clock}`
}

function buildStatusNotification(member, previousStatus, nextStatus, state) {
  const statusChanged = previousStatus?.status !== nextStatus.status
  const label = NTFY_STATUS_LABELS[nextStatus.status]
  const nickname = member.nickname
  const lines = []

  if (statusChanged) {
    if (nextStatus.status === 'sleep') lines.push(`${nickname}进入了睡觉中状态。`)
    else if (nextStatus.status === 'focus') lines.push(`${nickname}开始专注学习。`)
    else if (nextStatus.status === 'away') lines.push(`${nickname}已外出。`)
    else lines.push(`${nickname}已恢复正常活动。`)
  } else {
    lines.push(`${nickname}更新了${label}状态信息。`)
  }

  if (nextStatus.endAt) {
    const formatted = notificationTime(nextStatus.endAt, new Date(nextStatus.updatedAt))
    const timeLabel =
      nextStatus.status === 'sleep'
        ? '预计起床'
        : nextStatus.status === 'focus'
          ? '预计结束'
          : '预计回寝'
    if (formatted) lines.push(`${timeLabel}：${formatted}`)
  }

  if (nextStatus.status === 'normal') {
    lines.push(
      `更新时间：${notificationTime(nextStatus.updatedAt, new Date(nextStatus.updatedAt))}`,
    )
  }

  if (nextStatus.note) lines.push(`留言：${nextStatus.note}`)

  if (nextStatus.status === 'sleep' || nextStatus.status === 'focus') {
    const quietCount = state.statuses.filter(
      (item) => item.status === 'sleep' || item.status === 'focus',
    ).length
    lines.push(`当前安静人数：${quietCount} / ${state.room.capacity}`)
    lines.push('请尽量保持安静。')
  }

  return lines.join('\n')
}

async function publishNtfyMessage(topic, title, body) {
  if (!validNtfyTopic(topic)) return { ok: false }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), NTFY_TIMEOUT_MS)
  try {
    const response = await fetch(
      `${ntfyServerUrl()}/${encodeURIComponent(topic)}`,
      {
        method: 'POST',
        headers: {
          'content-type': 'text/plain; charset=utf-8',
          Title: encodeNtfyHeader(title),
          Priority: '4',
          Markdown: 'no',
        },
        body,
        signal: controller.signal,
      },
    )
    if (!response.ok) {
      console.error('ntfy publish failed', { status: response.status })
      return { ok: false }
    }
    return { ok: true }
  } catch (error) {
    console.error('ntfy publish failed', {
      code: error?.cause?.code || error?.name || 'UNKNOWN',
    })
    return { ok: false }
  } finally {
    clearTimeout(timeout)
  }
}

async function ensureRoomNtfyTopic(room) {
  if (validNtfyTopic(room.ntfyTopic)) return room

  const claimId = hashToken(`ntfy-topic:${room._id}`)
  let claim = await getDocument('systemSettings', claimId)
  if (!claim) {
    const topic = createNtfyTopic()
    const createdAt = nowIso()
    try {
      await db.collection('systemSettings').add({
        _id: claimId,
        roomId: room._id,
        ntfyTopic: topic,
        createdAt,
      })
    } catch (error) {
      if (!isDuplicateRecordError(error)) throw error
    }
    claim = await getDocument('systemSettings', claimId)
  }
  if (!claim || !validNtfyTopic(claim.ntfyTopic)) {
    throw new Error('NTFY_TOPIC_INITIALIZATION_FAILED')
  }

  const updatedAt = claim.createdAt || nowIso()
  await db.collection('rooms').doc(room._id).update({
    ntfyTopic: claim.ntfyTopic,
    ntfyTopicUpdatedAt: updatedAt,
  })
  return {
    ...room,
    ntfyTopic: claim.ntfyTopic,
    ntfyTopicUpdatedAt: updatedAt,
  }
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
  try {
    const result = await db.collection(collectionName).doc(id).get()
    return result.data?.[0] ?? null
  } catch (error) {
    if (
      error?.code === 'DOCUMENT_NOT_FOUND' ||
      String(error?.message || '').toLowerCase().includes('document not found')
    ) {
      return null
    }
    throw error
  }
}

async function getRoom(roomId) {
  return getDocument('rooms', roomId)
}

function configuredSecret(envName) {
  return String(process.env[envName] ?? '').trim()
}

async function verifyConfiguredSecret(event, suppliedValue, envName, scope) {
  const expected = configuredSecret(envName)
  if (!expected) {
    return {
      valid: false,
      response: fail('SERVER_KEY_NOT_CONFIGURED', '服务端密钥尚未配置'),
    }
  }

  const windowId = Math.floor(Date.now() / SECURITY_WINDOW_MS)
  const attemptId = hashToken(
    `${scope}:${String(event.clientIp || 'local')}:${windowId}`,
  )
  const attempt = await getDocument('securityAttempts', attemptId)
  if ((attempt?.count || 0) >= MAX_SECURITY_ATTEMPTS) {
    return {
      valid: false,
      response: fail('TOO_MANY_ATTEMPTS', '尝试次数过多，请稍后再试'),
    }
  }

  if (String(suppliedValue ?? '').trim() !== expected) {
    await db.collection('securityAttempts').doc(attemptId).set({
      scope,
      clientIp: String(event.clientIp || 'local'),
      windowId,
      count: (attempt?.count || 0) + 1,
      updatedAt: nowIso(),
    })
    return {
      valid: false,
      response: fail('INVALID_SECRET', '密钥错误'),
    }
  }

  if (attempt) {
    const { _id: _ignoredId, ...attemptData } = attempt
    await db.collection('securityAttempts').doc(attemptId).set({
      ...attemptData,
      count: 0,
      updatedAt: nowIso(),
    })
  }
  return { valid: true, response: null }
}

async function getRoomVerificationRollout() {
  if (verificationRolloutPromise) return verificationRolloutPromise
  verificationRolloutPromise = loadRoomVerificationRollout()
  return verificationRolloutPromise
}

async function loadRoomVerificationRollout() {
  const id = 'room-verification-rollout-v1'
  let setting = await getDocument('systemSettings', id)
  if (!setting) {
    const startedAt = nowIso()
    try {
      await db.collection('systemSettings').doc(id).set({
        startedAt,
        fallbackAt: new Date(
          Date.parse(startedAt) + EXISTING_ROOM_FALLBACK_MS,
        ).toISOString(),
      })
    } catch (error) {
      if (!isDuplicateRecordError(error)) throw error
    }
    setting = await getDocument('systemSettings', id)
  }
  return setting
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
      if (status.note === LEGACY_EXPIRED_NOTE) {
        const cleaned = {
          ...status,
          note: '',
          updatedAt: nowIso(),
        }
        await db.collection('statuses').doc(status._id).update({
          note: '',
          updatedAt: cleaned.updatedAt,
        })
        normalized.push(cleaned)
      } else {
        normalized.push(status)
      }
      continue
    }

    const next = {
      ...status,
      status: 'normal',
      endAt: null,
      note: '',
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

function isDuplicateRecordError(error) {
  const message = String(error?.message || '').toLowerCase()
  return (
    message.includes('duplicate') ||
    message.includes('already exist') ||
    message.includes('duplicate key')
  )
}

async function takeReleaseNotice(member) {
  const lastSeenVersion = versionParts(member.lastSeenReleaseVersion)
    ? member.lastSeenReleaseVersion
    : '0.0.0'
  if (compareVersions(lastSeenVersion, CURRENT_RELEASE_VERSION) >= 0) return null

  const missedReleases = releases.filter(
    (release) => compareVersions(release.version, lastSeenVersion) > 0,
  )
  const items = [...new Set(missedReleases.flatMap((release) => release.items))]
  if (items.length === 0) return null

  const claimedAt = nowIso()
  const claimId = hashToken(`${member._id}:${CURRENT_RELEASE_VERSION}`)
  const fromVersion = compareVersions(lastSeenVersion, '1.0.0') >= 0
    ? lastSeenVersion
    : '1.0.0'

  try {
    await db.collection('releaseClaims').add({
      _id: claimId,
      memberId: member._id,
      fromVersion,
      toVersion: CURRENT_RELEASE_VERSION,
      items,
      claimedAt,
    })
  } catch (error) {
    if (isDuplicateRecordError(error)) return null
    throw error
  }

  await db.collection('members').doc(member._id).update({
    lastSeenReleaseVersion: CURRENT_RELEASE_VERSION,
    releaseNoticeDeliveredAt: claimedAt,
  })

  return {
    id: claimId,
    fromVersion,
    toVersion: CURRENT_RELEASE_VERSION,
    items,
  }
}

function isRoomVerified(room) {
  return Boolean(
    room.creatorKeyVerifiedAt || room.verificationStatus === 'verified',
  )
}

async function getRoomVerification(room, member, rollout) {
  if (isRoomVerified(room)) return null

  const now = Date.now()
  const fallbackAt =
    room.verificationFallbackAt ||
    rollout.fallbackAt ||
    new Date(Date.parse(rollout.startedAt) + EXISTING_ROOM_FALLBACK_MS).toISOString()
  let promptedAt = room.verificationPromptedAt || null
  let deadlineAt = room.verificationDeadlineAt || null
  const isOwner = room.ownerId === member._id

  if (isOwner && !promptedAt) {
    promptedAt = nowIso()
    deadlineAt = new Date(
      Math.min(Date.parse(promptedAt) + EXISTING_ROOM_VERIFY_MS, Date.parse(fallbackAt)),
    ).toISOString()
    await db.collection('rooms').doc(room._id).update({
      verificationPromptedAt: promptedAt,
      verificationDeadlineAt: deadlineAt,
      verificationFallbackAt: fallbackAt,
      updatedAt: promptedAt,
    })
  }

  const effectiveDeadlineAt = deadlineAt || fallbackAt
  return {
    required: true,
    expired: now >= Date.parse(effectiveDeadlineAt),
    isOwner,
    promptedAt,
    deadlineAt,
    fallbackAt,
  }
}

async function buildState(
  member,
  currentDeviceId = '',
  claimCapacityNotice = false,
  claimReleaseNotice = false,
) {
  const room = await getRoom(member.roomId)
  if (!room || room.closed) return null

  const verificationRollout = await getRoomVerificationRollout()
  const verification = await getRoomVerification(room, member, verificationRollout)
  if (verification?.expired) {
    await deleteRoomRecords(room)
    return null
  }

  const capacityNotice = claimCapacityNotice
    ? await takeCapacityNotice(member, room)
    : null
  const releaseNotice = claimReleaseNotice ? await takeReleaseNotice(member) : null
  const [members, rawStatuses] = await Promise.all([
    getActiveMembers(member.roomId),
    getStatuses(member.roomId),
  ])
  const activeMemberIds = new Set(members.map((item) => item._id))
  const statuses = (await expireStatuses(rawStatuses)).filter((item) =>
    activeMemberIds.has(item.memberId),
  )
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
      notificationTopicUpdatedAt: room.ntfyTopicUpdatedAt || null,
      notificationTopicNeedsRotation: Boolean(room.ntfyTopicNeedsRotation),
    },
    currentMemberId: member._id,
    currentDeviceId,
    serverVersion: CURRENT_RELEASE_VERSION,
    roomVerification: verification
      ? {
          required: true,
          isOwner: verification.isOwner,
          promptedAt: verification.promptedAt,
          deadlineAt: verification.deadlineAt,
          fallbackAt: verification.fallbackAt,
        }
      : null,
    capacityNotice,
    releaseNotice,
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
    lastSeenReleaseVersion: null,
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

  const keyCheck = await verifyConfiguredSecret(
    event,
    event.creatorKey,
    'DORMSYNC_CREATOR_KEY',
    'create-room',
  )
  if (!keyCheck.valid) return keyCheck.response

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
      verificationStatus: 'verified',
      creatorKeyVerifiedAt: createdAt,
      ntfyTopic: createNtfyTopic(),
      ntfyTopicUpdatedAt: createdAt,
      ntfyTopicNeedsRotation: false,
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
    state: await buildState(member, created.member.sessionId, false, true),
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
    state: await buildState(member, joined.sessionId, false, true),
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

  const state = await buildState(member, sessionId, true, true)
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
  const state = await buildState(member, sessionId, true, true)
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

function notificationSettingsPayload(room, member) {
  const topic = room.ntfyTopic
  return {
    serverUrl: ntfyPublicServerUrl(),
    topic,
    topicUpdatedAt: room.ntfyTopicUpdatedAt || null,
    topicNeedsRotation: Boolean(room.ntfyTopicNeedsRotation),
    isOwner: room.ownerId === member._id,
    roomName: room.name,
    androidDeepLink: `ntfy://${ntfyPublicServerUrl().replace(/^https?:\/\//, '')}/${topic}?display=${encodeURIComponent(room.name)}`,
    installUrl: 'https://docs.ntfy.sh/subscribe/phone/',
  }
}

async function handleGetNotificationSettings(member) {
  let room = await getRoom(member.roomId)
  if (!room || room.closed) return fail('ROOM_NOT_FOUND', '宿舍不存在或已经关闭')
  room = await ensureRoomNtfyTopic(room)
  return ok(notificationSettingsPayload(room, member))
}

async function handleRotateNotificationTopic(member) {
  const room = await getRoom(member.roomId)
  if (!room || room.closed) return fail('ROOM_NOT_FOUND', '宿舍不存在或已经关闭')
  if (room.ownerId !== member._id) {
    return fail('ONLY_OWNER', '只有房主可以重新生成通知频道')
  }

  const topic = createNtfyTopic()
  const updatedAt = nowIso()
  await db.collection('rooms').doc(member.roomId).update({
    ntfyTopic: topic,
    ntfyTopicUpdatedAt: updatedAt,
    ntfyTopicNeedsRotation: false,
    updatedAt,
  })
  await db.collection('systemSettings').doc(hashToken(`ntfy-topic:${room._id}`)).set({
    roomId: room._id,
    ntfyTopic: topic,
    createdAt: updatedAt,
  })

  return ok(
    notificationSettingsPayload(
      {
        ...room,
        ntfyTopic: topic,
        ntfyTopicUpdatedAt: updatedAt,
        ntfyTopicNeedsRotation: false,
      },
      member,
    ),
  )
}

async function handleSendTestNotification(member) {
  let room = await getRoom(member.roomId)
  if (!room || room.closed) return fail('ROOM_NOT_FOUND', '宿舍不存在或已经关闭')
  if (room.ownerId !== member._id) {
    return fail('ONLY_OWNER', '只有房主可以发送测试通知')
  }
  const lastSentAt = Date.parse(room.lastNtfyTestAt || '')
  if (Number.isFinite(lastSentAt) && Date.now() - lastSentAt < NTFY_TEST_COOLDOWN_MS) {
    return fail('NOTIFICATION_RATE_LIMITED', '测试通知一分钟只能发送一次')
  }

  room = await ensureRoomNtfyTopic(room)
  const body = [
    '这是 DormSync 通知测试。',
    `宿舍：${room.name}`,
    `发送者：${member.nickname}`,
  ].join('\n')
  const sent = await publishNtfyMessage(
    room.ntfyTopic,
    NOTIFICATION_TEST_TITLE,
    body,
  )
  if (!sent.ok) return fail('NOTIFICATION_SEND_FAILED', '测试通知发送失败')

  const sentAt = nowIso()
  await db.collection('rooms').doc(member.roomId).update({
    lastNtfyTestAt: sentAt,
  })
  return ok({ sent: true, sentAt })
}

async function handleUpdateStatus(event, member, currentDeviceId) {
  if (!VALID_STATUSES.has(event.status)) {
    return fail('INVALID_STATUS', '状态无效')
  }
  if (REQUIRED_TIME_STATUSES.has(event.status) && !event.endAt) {
    return fail(
      'END_TIME_REQUIRED',
      event.status === 'away' ? '外出需要设置预计回寝时间' : '睡觉中需要设置预计起床时间',
    )
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
  const previousStatus = statusResult.data[0] || null
  const note = cleanText(event.note, 30)
  const updatedAt = nowIso()
  const status = {
    memberId: member._id,
    roomId: member.roomId,
    status: event.status,
    note,
    endAt,
    updatedAt,
  }
  const changed =
    previousStatus?.status !== status.status ||
    (previousStatus?.note || '') !== status.note ||
    (previousStatus?.endAt || null) !== status.endAt

  if (previousStatus) {
    await db.collection('statuses').doc(previousStatus._id).update(status)
  } else {
    await db.collection('statuses').add(status)
  }

  const state = await buildState(member, currentDeviceId)
  if (!state || !changed) return ok(state)

  const room = await getRoom(member.roomId)
  if (!room || !validNtfyTopic(room.ntfyTopic)) return ok(state)

  const body = buildStatusNotification(member, previousStatus, status, state)
  const sent = await publishNtfyMessage(
    room.ntfyTopic,
    NOTIFICATION_TITLE,
    body,
  )
  return ok(
    sent.ok
      ? state
      : {
          ...state,
          notificationWarning: '状态已保存，但宿舍通知发送失败',
        },
  )
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

async function handleAcknowledgeReleaseNotice(event, member) {
  const noticeId = cleanText(event.noticeId, 100)
  if (!noticeId) return fail('INVALID_NOTICE', '通知无效')

  const claim = await getDocument('releaseClaims', noticeId)
  if (!claim || claim.memberId !== member._id) {
    return fail('INVALID_NOTICE', '通知无效')
  }

  await db.collection('releaseClaims').doc(noticeId).update({
    acknowledgedAt: nowIso(),
  })
  return ok({ acknowledged: true })
}

async function handleVerifyRoomKey(event, member, currentDeviceId) {
  const room = await getRoom(member.roomId)
  if (!room || room.closed) return fail('ROOM_NOT_FOUND', '宿舍不存在或已经关闭')
  if (room.ownerId !== member._id) {
    return fail('ONLY_OWNER', '只有房主可以完成寝室验证')
  }
  if (isRoomVerified(room)) {
    return ok(await buildState(member, currentDeviceId))
  }

  const keyCheck = await verifyConfiguredSecret(
    event,
    event.creatorKey,
    'DORMSYNC_CREATOR_KEY',
    'verify-existing-room',
  )
  if (!keyCheck.valid) return keyCheck.response

  const verifiedAt = nowIso()
  await db.collection('rooms').doc(member.roomId).update({
    verificationStatus: 'verified',
    creatorKeyVerifiedAt: verifiedAt,
    verificationPromptedAt: null,
    verificationDeadlineAt: null,
    verificationFallbackAt: null,
    verifiedBy: member._id,
    updatedAt: verifiedAt,
  })

  return ok(await buildState(member, currentDeviceId))
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
  await db.collection('rooms').doc(member.roomId).update({
    ntfyTopicNeedsRotation: true,
    updatedAt: nowIso(),
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
  const statusResult = await db
    .collection('statuses')
    .where({ memberId: member._id })
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
  await db.collection('rooms').doc(member.roomId).update({
    ntfyTopicNeedsRotation: true,
    updatedAt: nowIso(),
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

async function deleteCollectionRows(collectionName, query, limit = 100) {
  const result = await db
    .collection(collectionName)
    .where(query)
    .limit(limit)
    .get()
  await Promise.all(
    result.data.map((row) => db.collection(collectionName).doc(row._id).delete()),
  )
  return result.data.length
}

async function deleteRoomRecords(room) {
  if (!room?._id) return
  const members = await getActiveMembers(room._id)
  await Promise.all(
    members.map(async (member) => {
      await Promise.all([
        deleteCollectionRows('deviceSessions', { memberId: member._id }),
        deleteCollectionRows('deviceLinks', { memberId: member._id }),
        deleteCollectionRows('releaseClaims', { memberId: member._id }),
      ])
      await db.collection('members').doc(member._id).delete()
    }),
  )
  await Promise.all([
    deleteCollectionRows('statuses', { roomId: room._id }),
    deleteCollectionRows('deviceSessions', { roomId: room._id }),
    deleteCollectionRows('deviceLinks', { roomId: room._id }),
    deleteCollectionRows('members', { roomId: room._id }),
    deleteCollectionRows('releaseClaims', { roomId: room._id }),
    deleteCollectionRows('systemSettings', { roomId: room._id }),
  ])
  await db.collection('rooms').doc(room._id).delete()
}

async function listAllRooms() {
  const rooms = []
  const pageSize = 100
  for (let offset = 0; offset < 1000; offset += pageSize) {
    const result = await db
      .collection('rooms')
      .limit(pageSize)
      .skip(offset)
      .get()
    rooms.push(...result.data)
    if (result.data.length < pageSize) break
  }
  return rooms
}

async function cleanupExpiredUnverifiedRooms() {
  const rollout = await getRoomVerificationRollout()
  const rooms = await listAllRooms()
  let deleted = 0
  for (const room of rooms) {
    if (isRoomVerified(room)) continue
    const fallbackAt =
      room.verificationFallbackAt ||
      rollout.fallbackAt ||
      new Date(Date.parse(rollout.startedAt) + EXISTING_ROOM_FALLBACK_MS).toISOString()
    const deadlineAt = room.verificationDeadlineAt || fallbackAt
    if (Date.now() >= Date.parse(deadlineAt)) {
      await deleteRoomRecords(room)
      deleted += 1
    }
  }
  return { checked: rooms.length, deleted }
}

async function handleAdminListRooms(event) {
  const keyCheck = await verifyConfiguredSecret(
    event,
    event.adminKey,
    'DORMSYNC_ADMIN_KEY',
    'admin-list-rooms',
  )
  if (!keyCheck.valid) return keyCheck.response

  const rollout = await getRoomVerificationRollout()
  const rooms = await listAllRooms()
  const summaries = []
  for (const room of rooms) {
    const members = await getActiveMembers(room._id)
    const owner = members.find((member) => member._id === room.ownerId)
    const latestMemberSeen = members
      .map((member) => Date.parse(member.lastSeenAt || ''))
      .filter((value) => Number.isFinite(value))
    const fallbackAt =
      room.verificationFallbackAt ||
      rollout.fallbackAt ||
      new Date(Date.parse(rollout.startedAt) + EXISTING_ROOM_FALLBACK_MS).toISOString()
    const deadlineAt = room.verificationDeadlineAt || fallbackAt
    summaries.push({
      id: room._id,
      name: room.name,
      ownerNickname: owner?.nickname || '',
      memberCount: members.length,
      capacity: room.capacity || DEFAULT_ROOM_CAPACITY,
      createdAt: room.createdAt || null,
      lastActiveAt:
        latestMemberSeen.length > 0
          ? new Date(Math.max(...latestMemberSeen)).toISOString()
          : room.updatedAt || room.createdAt || null,
      verificationStatus: isRoomVerified(room) ? 'verified' : 'pending',
      verificationPromptedAt: room.verificationPromptedAt || null,
      verificationDeadlineAt: isRoomVerified(room) ? null : deadlineAt,
      verificationFallbackAt: isRoomVerified(room) ? null : fallbackAt,
      closed: Boolean(room.closed),
    })
  }
  summaries.sort(
    (left, right) =>
      Date.parse(right.lastActiveAt || '') - Date.parse(left.lastActiveAt || ''),
  )
  return ok({ rooms: summaries })
}

const VERIFICATION_BYPASS_ACTIONS = new Set([
  'getState',
  'verifyExistingRoom',
  'revokeDevice',
  'leaveRoom',
])

async function roomVerificationGate(member, action) {
  if (VERIFICATION_BYPASS_ACTIONS.has(action)) return null
  const room = await getRoom(member.roomId)
  if (!room || room.closed) return fail('ROOM_NOT_FOUND', '宿舍不存在或已经关闭')

  const rollout = await getRoomVerificationRollout()
  const verification = await getRoomVerification(room, member, rollout)
  if (!verification) return null
  if (verification.expired) {
    await deleteRoomRecords(room)
    return fail('ROOM_NOT_FOUND', '宿舍不存在或已经关闭')
  }
  return fail('ROOM_VERIFICATION_REQUIRED', '寝室等待房主完成授权验证')
}

async function dispatch(event = {}) {
  try {
    await ensureCollections()

    if (event.action === 'createRoom') return await handleCreateRoom(event)
    if (event.action === 'joinRoom') return await handleJoinRoom(event)
    if (event.action === 'claimDeviceLink') return await handleClaimDeviceLink(event)
    if (event.action === 'recoverAccount') return await handleRecoverAccount(event)
    if (event.action === 'adminListRooms') return await handleAdminListRooms(event)

    const context = await findAuthenticatedContext(event.memberToken)
    if (!context) return fail('AUTH_REQUIRED', '登录状态已失效，请重新绑定或恢复账号')
    const { member, session } = context
    const verificationBlock = await roomVerificationGate(member, event.action)
    if (verificationBlock) return verificationBlock

    if (event.action === 'getState') {
      const state = await buildState(
        member,
        session._id,
        Boolean(event.claimCapacityNotice),
        Boolean(event.claimReleaseNotice),
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
    if (event.action === 'acknowledgeReleaseNotice') {
      return await handleAcknowledgeReleaseNotice(event, member)
    }
    if (event.action === 'verifyExistingRoom') {
      return await handleVerifyRoomKey(event, member, session._id)
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
    if (event.action === 'getNotificationSettings') {
      return await handleGetNotificationSettings(member)
    }
    if (event.action === 'rotateNotificationTopic') {
      return await handleRotateNotificationTopic(member)
    }
    if (event.action === 'sendTestNotification') {
      return await handleSendTestNotification(member)
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

function requestClientIp(event) {
  const forwarded =
    event.headers?.['x-forwarded-for'] ||
    event.headers?.['X-Forwarded-For'] ||
    ''
  return (
    event.requestContext?.http?.sourceIp ||
    String(forwarded).split(',')[0].trim() ||
    'unknown'
  )
}

exports.cleanup = async () => {
  await ensureCollections()
  const result = await cleanupExpiredUnverifiedRooms()
  return ok(result)
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
    payload.clientIp = requestClientIp(event)
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
