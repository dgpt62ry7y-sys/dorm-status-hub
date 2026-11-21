const path = require('node:path')
const crypto = require('node:crypto')
const {
  createMemoryDatabase,
  installCloudBaseMock,
} = require('./support/memory-cloudbase.cjs')

process.env.DORMSYNC_CREATOR_KEY = 'test-creator-key'
process.env.DORMSYNC_ADMIN_KEY = 'test-admin-key'
process.env.DORMSYNC_NTFY_SERVER = 'https://publish.ntfy.test/'
process.env.DORMSYNC_NTFY_PUBLIC_URL = 'https://ntfy.sh'

const database = createMemoryDatabase()
const restoreCloudBase = installCloudBaseMock(database)

const sentNotifications = []
let notificationRequestOk = true

global.fetch = async (url, options = {}) => {
  sentNotifications.push({
    url: String(url),
    method: options.method,
    headers: { ...(options.headers || {}) },
    body: String(options.body || ''),
  })
  return {
    ok: notificationRequestOk,
    status: notificationRequestOk ? 200 : 503,
  }
}

const backend = require(path.join(__dirname, '..', 'cloudfunctions', 'api', 'index.js'))
const { buildStatusNotification, notificationSafeText } =
  backend.__testNotificationFormatting
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

function expectError(result, code, label) {
  if (result.ok || result.error.code !== code) {
    throw new Error(`${label}: expected ${code}, received ${JSON.stringify(result)}`)
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}\nExpected:\n${expected}\nReceived:\n${actual}`)
  }
}

function decodeNtfyTitle(value) {
  const match = /^=\?UTF-8\?B\?(.+)\?=$/i.exec(String(value || ''))
  return match ? Buffer.from(match[1], 'base64').toString('utf8') : String(value || '')
}

function beijingTomorrowAt(hour, minute) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  const today = Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day))
  const tomorrow = new Date(today + 86_400_000).toISOString().slice(0, 10)
  const clock = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
  return new Date(`${tomorrow}T${clock}:00+08:00`).toISOString()
}

function testNotificationFormatting() {
  const member = { nickname: '小明' }
  const state = {
    room: { capacity: 4 },
    statuses: [
      { memberId: 'x', status: 'sleep' },
      { memberId: 'm', status: 'focus' },
    ],
  }
  const updatedAt = '2026-11-21T22:00:00+08:00'

  assertEqual(
    buildStatusNotification(
      member,
      {
        status: 'sleep',
        endAt: '2026-11-22T07:30:00+08:00',
        note: '晚安',
        updatedAt,
      },
      state,
    ),
    [
      '💤 小明 正在睡觉',
      '⏰ 预计起床：明天 07:30',
      '💬 留言：晚安',
      '🤫 安静人数：2 / 4，请尽量保持安静。',
    ].join('\n'),
    'Sleep formatting is incorrect',
  )
  assertEqual(
    buildStatusNotification(
      member,
      { status: 'sleep', endAt: null, note: '', updatedAt },
      state,
    ),
    ['💤 小明 正在睡觉', '🤫 安静人数：2 / 4，请尽量保持安静。'].join('\n'),
    'Optional sleep lines were not omitted',
  )
  assertEqual(
    buildStatusNotification(
      member,
      {
        status: 'focus',
        endAt: '2026-11-22T23:00:00+08:00',
        note: '复习数学',
        updatedAt,
      },
      state,
    ),
    [
      '📚 小明 正在专注学习',
      '⏰ 预计结束：明天 23:00',
      '💬 留言：复习数学',
      '🤫 安静人数：2 / 4，请尽量保持安静。',
    ].join('\n'),
    'Focus formatting is incorrect',
  )
  assertEqual(
    buildStatusNotification(
      member,
      {
        status: 'away',
        endAt: '2026-11-22T20:00:00+08:00',
        note: '去实验室',
        updatedAt,
      },
      state,
    ),
    ['🚶 小明 已外出', '🏠 预计回寝：明天 20:00', '💬 留言：去实验室'].join(
      '\n',
    ),
    'Away formatting is incorrect',
  )
  assertEqual(
    buildStatusNotification(
      member,
      { status: 'away', endAt: null, note: '', updatedAt },
      state,
    ),
    '🚶 小明 已外出',
    'Away optional lines were not omitted',
  )
  assertEqual(
    buildStatusNotification(
      member,
      { status: 'normal', endAt: null, note: '回寝了', updatedAt },
      state,
    ),
    ['🏠 小明 已恢复正常活动', '🕒 更新时间：22:00', '💬 留言：回寝了'].join(
      '\n',
    ),
    'Normal formatting is incorrect',
  )
  assertEqual(
    notificationSafeText('小明\n📚\t第一行\r\n第二行'),
    '小明 📚 第一行 第二行',
    'Notification text cleanup is incorrect',
  )
  assertEqual(
    buildStatusNotification(
      { nickname: '小明\n📚' },
      {
        status: 'focus',
        endAt: null,
        note: '第一行\n第二行',
        updatedAt,
      },
      state,
    )
      .split('\n')
      .length,
    3,
    'Nickname or note injected an extra notification line',
  )
}

async function createRoom(label, capacity = 4) {
  return ok(
    await invoke({
      action: 'createRoom',
      roomName: label,
      nickname: `${label}房主`,
      capacity,
      creatorKey: 'test-creator-key',
      deviceLabel: 'Notification Test Owner',
    }),
    `create ${label}`,
  )
}

async function joinRoom(room, nickname) {
  return ok(
    await invoke({
      action: 'joinRoom',
      inviteCode: room.state.room.inviteCode,
      nickname,
      deviceLabel: `${nickname} Device`,
      joinRequestId: crypto.randomUUID(),
      deviceInstanceId: crypto.randomUUID(),
    }),
    `join ${nickname}`,
  )
}

async function updateStatus(memberToken, update, label) {
  return ok(
    await invoke({
      action: 'updateStatus',
      memberToken,
      ...update,
    }),
    label,
  )
}

async function run() {
  testNotificationFormatting()
  const suffix = String(Date.now()).slice(-6)
  const room = await createRoom(`通知测试${suffix}`)
  const roomId = room.state.room.id
  const ownerToken = room.memberToken
  const inviteCode = room.state.room.inviteCode

  assert(
    !('ntfyTopic' in room.state.room),
    'createRoom response exposed the ntfy Topic',
  )
  assert(
    !JSON.stringify(room).includes('dormsync-'),
    'createRoom response contained a Topic-like value',
  )

  const ownerSettings = ok(
    await invoke({ action: 'getNotificationSettings', memberToken: ownerToken }),
    'owner notification settings',
  )
  assert(
    /^dormsync-[A-Za-z0-9_-]{40,}$/.test(ownerSettings.topic),
    'Topic format is invalid',
  )
  assert(ownerSettings.topic.length <= 64, 'Topic is longer than 64 characters')
  assert(ownerSettings.serverUrl === 'https://ntfy.sh', 'Public ntfy URL is incorrect')
  assert(ownerSettings.isOwner, 'Owner flag is missing')
  assert(
    ownerSettings.androidDeepLink.startsWith('ntfy://ntfy.sh/dormsync-'),
    'Android deep link is incorrect',
  )

  const memberA = await joinRoom(room, `成员A${suffix}`)
  const memberB = await joinRoom(room, `成员B${suffix}`)
  const memberC = await joinRoom(room, `成员C${suffix}`)
  const memberASettings = ok(
    await invoke({
      action: 'getNotificationSettings',
      memberToken: memberA.memberToken,
    }),
    'member A notification settings',
  )
  assert(
    memberASettings.topic === ownerSettings.topic,
    'Members of the same room received different Topics',
  )
  assert(!memberASettings.isOwner, 'Member was marked as owner')

  const secondRoom = await createRoom(`另一个通知测试${suffix}`)
  const secondSettings = ok(
    await invoke({
      action: 'getNotificationSettings',
      memberToken: secondRoom.memberToken,
    }),
    'second room notification settings',
  )
  assert(
    secondSettings.topic !== ownerSettings.topic,
    'Different rooms received the same Topic',
  )

  const storedRoom = database.data.get('rooms').find((item) => item._id === roomId)
  delete storedRoom.ntfyTopic
  delete storedRoom.ntfyTopicUpdatedAt
  const [legacyOwnerSettings, legacyMemberSettings] = await Promise.all([
    invoke({ action: 'getNotificationSettings', memberToken: ownerToken }),
    invoke({ action: 'getNotificationSettings', memberToken: memberA.memberToken }),
  ])
  const legacyOwner = ok(legacyOwnerSettings, 'legacy owner Topic initialization')
  const legacyMember = ok(legacyMemberSettings, 'legacy member Topic initialization')
  assert(
    legacyOwner.topic === legacyMember.topic,
    'Concurrent legacy Topic initialization returned different Topics',
  )
  const claimRows = database.data
    .get('systemSettings')
    .filter((item) => item.roomId === roomId)
  assert(claimRows.length === 1, 'Legacy Topic initialization created multiple claims')
  assert(claimRows[0].ntfyTopic === legacyOwner.topic, 'Topic claim is inconsistent')

  const focusEnd = beijingTomorrowAt(21, 30)
  await updateStatus(
    memberB.memberToken,
    { status: 'focus', note: '准备考试', endAt: focusEnd },
    'seed focus status',
  )
  await updateStatus(
    memberC.memberToken,
    { status: 'sleep', note: '', endAt: beijingTomorrowAt(7, 30) },
    'seed sleep status',
  )
  sentNotifications.length = 0

  await updateStatus(
    ownerToken,
    { status: 'focus', note: '赶论文', endAt: focusEnd },
    'focus status',
  )
  let message = sentNotifications.at(-1)
  assert(message, 'Focus status did not send a notification')
  assert(message.method === 'POST', 'Notification was not published with POST')
  assert(
    message.url.startsWith('https://publish.ntfy.test/dormsync-'),
    'Notification used the wrong publish URL',
  )
  assert(message.headers.Priority === '4', 'Notification priority was not 4')
  assert(message.headers.Tags === 'bell', 'Notification bell tag is missing')
  assert(
    /^=\?UTF-8\?B\?.+\?=$/.test(message.headers.Title),
    'Chinese title was not RFC 2047 encoded',
  )
  assert(
    decodeNtfyTitle(message.headers.Title) === 'DormSync · 宿舍状态更新',
    'Notification title is incorrect',
  )
  assert(message.body.startsWith('📚 '), 'Focus notification emoji is incorrect')
  assert(message.body.includes('正在专注学习'), 'Focus notification copy is incorrect')
  assert(message.body.includes('⏰ 预计结束：明天 21:30'), 'Next-day focus time is incorrect')
  assert(message.body.includes('💬 留言：赶论文'), 'Focus note is missing')
  assert(
    message.body.includes('🤫 安静人数：3 / 4，请尽量保持安静。'),
    'Quiet count did not include sleep and focus',
  )

  const beforeNoteOnly = sentNotifications.length
  await updateStatus(
    ownerToken,
    { status: 'focus', note: '继续赶论文', endAt: focusEnd },
    'focus note-only update',
  )
  assert(
    sentNotifications.length === beforeNoteOnly + 1,
    'Note-only update did not send exactly one notification',
  )
  assert(
    sentNotifications.at(-1).body.startsWith('📚 ') &&
      sentNotifications.at(-1).body.includes('正在专注学习') &&
      sentNotifications.at(-1).body.includes('💬 留言：继续赶论文'),
    'Note-only update copy is incorrect',
  )

  const nextFocusEnd = beijingTomorrowAt(22, 0)
  const beforeEndOnly = sentNotifications.length
  await updateStatus(
    ownerToken,
    { status: 'focus', note: '继续赶论文', endAt: nextFocusEnd },
    'focus end-only update',
  )
  assert(
    sentNotifications.length === beforeEndOnly + 1,
    'End-time-only update did not send exactly one notification',
  )
  assert(
    sentNotifications.at(-1).body.includes('⏰ 预计结束：明天 22:00'),
    'End-time-only notification is incorrect',
  )

  const beforeNoChange = sentNotifications.length
  await updateStatus(
    ownerToken,
    { status: 'focus', note: '继续赶论文', endAt: nextFocusEnd },
    'unchanged status',
  )
  assert(
    sentNotifications.length === beforeNoChange,
    'Unchanged status sent a notification',
  )

  await updateStatus(
    ownerToken,
    { status: 'sleep', note: '', endAt: beijingTomorrowAt(7, 30) },
    'sleep status',
  )
  message = sentNotifications.at(-1)
  assert(message.body.startsWith('💤 '), 'Sleep notification emoji is incorrect')
  assert(message.body.includes('正在睡觉'), 'Sleep notification copy is incorrect')
  assert(message.body.includes('⏰ 预计起床：明天 07:30'), 'Sleep time is incorrect')

  await updateStatus(
    ownerToken,
    { status: 'away', note: '去实验室', endAt: beijingTomorrowAt(20, 0) },
    'away status',
  )
  message = sentNotifications.at(-1)
  assert(message.body.startsWith('🚶 '), 'Away notification emoji is incorrect')
  assert(message.body.includes('已外出'), 'Away notification copy is incorrect')
  assert(message.body.includes('🏠 预计回寝：明天 20:00'), 'Away return time is incorrect')
  assert(!message.body.includes('🤫'), 'Away notification included quiet count')
  assert(!message.body.includes('安静人数'), 'Away notification included quiet copy')

  await updateStatus(
    ownerToken,
    { status: 'normal', note: '', endAt: null },
    'normal status',
  )
  message = sentNotifications.at(-1)
  assert(message.body.startsWith('🏠 '), 'Normal notification emoji is incorrect')
  assert(message.body.includes('已恢复正常活动'), 'Normal notification copy is incorrect')
  assert(message.body.includes('🕒 更新时间：'), 'Normal notification has no update time')
  assert(!message.body.includes('🤫'), 'Normal notification included quiet count')

  notificationRequestOk = false
  const failedState = await updateStatus(
    ownerToken,
    { status: 'sleep', note: '', endAt: beijingTomorrowAt(7, 30) },
    'notification failure status save',
  )
  assert(
    failedState.notificationWarning === '状态已保存，但部分宿舍通知发送失败',
    'Notification failure warning is missing',
  )
  notificationRequestOk = true
  const persisted = ok(
    await invoke({ action: 'getState', memberToken: ownerToken }),
    'state after notification failure',
  )
  assert(
    persisted.statuses.find((item) => item.memberId === room.state.currentMemberId)
      ?.status === 'sleep',
    'Notification failure rolled back the saved status',
  )

  expectError(
    await invoke({
      action: 'sendTestNotification',
      memberToken: memberA.memberToken,
    }),
    'ONLY_OWNER',
    'member test notification permission',
  )
  const beforeTest = sentNotifications.length
  ok(
    await invoke({ action: 'sendTestNotification', memberToken: ownerToken }),
    'owner test notification',
  )
  assert(
    sentNotifications.length === beforeTest + 1,
    'Owner test notification was not sent',
  )
  message = sentNotifications.at(-1)
  assert(
    decodeNtfyTitle(message.headers.Title) === 'DormSync · 宿舍通知测试',
    'Test notification title is incorrect',
  )
  assert(message.body.includes('宿舍：通知测试'), 'Test notification room name is missing')
  expectError(
    await invoke({ action: 'sendTestNotification', memberToken: ownerToken }),
    'NOTIFICATION_RATE_LIMITED',
    'test notification cooldown',
  )

  expectError(
    await invoke({
      action: 'rotateNotificationTopic',
      memberToken: memberA.memberToken,
    }),
    'ONLY_OWNER',
    'member Topic rotation permission',
  )
  const oldTopic = legacyOwner.topic
  const rotatedSettings = ok(
    await invoke({
      action: 'rotateNotificationTopic',
      memberToken: ownerToken,
    }),
    'owner Topic rotation',
  )
  assert(rotatedSettings.topic !== oldTopic, 'Topic rotation did not change the Topic')
  assert(!rotatedSettings.topicNeedsRotation, 'Rotation flag remained set')

  await updateStatus(
    ownerToken,
    { status: 'focus', note: '轮换后测试', endAt: focusEnd },
    'status after Topic rotation',
  )
  message = sentNotifications.at(-1)
  assert(
    message.url.includes(rotatedSettings.topic),
    'New status was not published to the rotated Topic',
  )
  assert(
    !message.url.includes(oldTopic),
    'New status was published to the old Topic',
  )

  ok(
    await invoke({
      action: 'removeMember',
      memberToken: ownerToken,
      memberId: memberA.state.currentMemberId,
    }),
    'remove member for rotation notice',
  )
  let currentSettings = ok(
    await invoke({ action: 'getNotificationSettings', memberToken: ownerToken }),
    'settings after member removal',
  )
  assert(
    currentSettings.topicNeedsRotation,
    'Member removal did not request Topic rotation',
  )

  currentSettings = ok(
    await invoke({
      action: 'rotateNotificationTopic',
      memberToken: ownerToken,
    }),
    'rotation after member removal',
  )
  assert(!currentSettings.topicNeedsRotation, 'Rotated Topic still needs rotation')
  ok(
    await invoke({ action: 'leaveRoom', memberToken: memberB.memberToken }),
    'member leaves room',
  )
  const stateAfterLeave = ok(
    await invoke({ action: 'getState', memberToken: ownerToken }),
    'state after member leave',
  )
  assert(
    stateAfterLeave.room.notificationTopicNeedsRotation,
    'Member leave did not request Topic rotation',
  )
  assert(
    !stateAfterLeave.statuses.some(
      (item) => item.memberId === memberB.state.currentMemberId,
    ),
    'State exposed the status of a member who left',
  )

  const memberCStatus = database.data
    .get('statuses')
    .find((item) => item.memberId === memberC.state.currentMemberId)
  memberCStatus.endAt = new Date(Date.now() - 1_000).toISOString()
  const beforeExpiry = sentNotifications.length
  ok(
    await invoke({ action: 'getState', memberToken: ownerToken }),
    'automatic status expiry',
  )
  assert(
    sentNotifications.length === beforeExpiry,
    'Automatic status expiry sent a notification',
  )

  const sensitiveValues = [
    ownerToken,
    memberA.memberToken,
    memberB.memberToken,
    memberC.memberToken,
    room.memberToken,
    inviteCode,
    room.recoveryCode,
    ownerSettings.topic,
    rotatedSettings.topic,
  ].filter(Boolean)
  for (const notification of sentNotifications) {
    const wireMessage = `${notification.headers.Title || ''}\n${notification.body}`
    for (const sensitiveValue of sensitiveValues) {
      assert(
        !wireMessage.includes(sensitiveValue),
        'Notification body or title contained a sensitive value',
      )
    }
    assert(!wireMessage.includes('memberToken'), 'Notification contained a token field name')
    assert(!wireMessage.includes('recoveryCode'), 'Notification contained a recovery-code field name')
    assert(!wireMessage.includes('inviteCode'), 'Notification contained an invite-code field name')
  }

  console.log(
    JSON.stringify(
      {
        topicHiddenFromCreateResponse: true,
        sharedTopicPerRoom: true,
        uniqueTopicAcrossRooms: true,
        legacyConcurrentInitialization: true,
        priorityAndRfc2047Title: true,
        fourStatusNotificationCopy: true,
        emojiAndMultilineFormatting: true,
        noteAndEndTimeTriggers: true,
        unchangedStatusDoesNotNotify: true,
        quietCountUsesSleepAndFocus: true,
        notificationFailureKeepsStatus: true,
        ownerOnlyTestNotification: true,
        testNotificationCooldown: true,
        ownerOnlyTopicRotation: true,
        rotatedTopicUsedForNewMessages: true,
        memberRemovalAndLeaveRequestRotation: true,
        automaticExpiryDoesNotNotify: true,
        notificationPayloadSanitized: true,
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
