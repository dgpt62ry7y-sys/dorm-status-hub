const crypto = require('node:crypto')
const path = require('node:path')
const {
  createMemoryDatabase,
  installCloudBaseMock,
} = require('./support/memory-cloudbase.cjs')

process.env.DORMSYNC_CREATOR_KEY = 'test-creator-key'
process.env.DORMSYNC_ADMIN_KEY = 'test-admin-key'
process.env.DORMSYNC_BARK_ENCRYPTION_KEY = '0123456789abcdef'.repeat(4)

const barkRequests = []
global.fetch = async (url, init = {}) => {
  if (String(url).includes('api.day.app')) {
    barkRequests.push(JSON.parse(String(init.body || '{}')))
    return {
      ok: true,
      status: 200,
      json: async () => ({ code: 200 }),
    }
  }
  throw new Error(`Unexpected fetch ${url}`)
}

const database = createMemoryDatabase()
const restoreCloudBase = installCloudBaseMock(database)
const backend = require(path.join(__dirname, '..', 'cloudfunctions', 'api', 'index.js'))
restoreCloudBase()

async function invoke(payload, clientIp = 'feedback-test-ip') {
  const response = await backend.main({
    httpMethod: 'POST',
    body: JSON.stringify(payload),
    requestContext: { http: { sourceIp: clientIp } },
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

async function run() {
  const suffix = String(Date.now()).slice(-6)
  const publicConfig = ok(
    await invoke({ action: 'getPublicConfig' }),
    'public config',
  )
  if (!publicConfig.releaseVersion || publicConfig.feedbackEnabled !== true) {
    throw new Error('Public config is incomplete')
  }

  const created = ok(
    await invoke({
      action: 'createRoom',
      roomName: `反馈测试${suffix}`,
      nickname: `反馈房主${suffix}`,
      capacity: 4,
      creatorKey: 'test-creator-key',
      deviceLabel: 'Feedback Test',
      deviceInstanceId: crypto.randomUUID(),
    }),
    'create feedback room',
  )

  const barkKey = 'FeedbackBarkKey123456'
  ok(
    await invoke({
      action: 'adminSaveFeedbackBark',
      adminKey: 'test-admin-key',
      deviceKey: barkKey,
    }),
    'save feedback bark',
  )
  if (
    barkRequests.length !== 1 ||
    !String(barkRequests[0].title).includes('反馈通知已连接')
  ) {
    throw new Error('Feedback Bark setup test was not sent')
  }

  const creationDeviceId = crypto.randomUUID()
  const firstFeedback = ok(
    await invoke({
      action: 'submitFeedback',
      items: ['创建页希望增加更清楚的说明'],
      contact: 'wechat-feedback',
      page: 'creation',
      appVersion: '1.10.0',
      deviceLabel: 'iPhone · 微信',
      deviceInstanceId: creationDeviceId,
    }),
    'anonymous feedback',
  )
  if (!firstFeedback.id || barkRequests.length !== 2) {
    throw new Error('Anonymous feedback was not saved or notified')
  }

  const settingsFeedback = ok(
    await invoke({
      action: 'submitFeedback',
      items: ['设置页反馈第一项', '设置页反馈第二项'],
      contact: 'private-contact@example.com',
      page: 'settings',
      appVersion: '1.10.0',
      deviceLabel: 'Android · Chrome',
      deviceInstanceId: crypto.randomUUID(),
      memberToken: created.memberToken,
    }),
    'authenticated feedback',
  )
  if (!settingsFeedback.id || barkRequests.length !== 3) {
    throw new Error('Authenticated feedback was not saved or notified')
  }
  if (String(barkRequests[2].body).includes('private-contact@example.com')) {
    throw new Error('Bark notification exposed feedback contact')
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    ok(
      await invoke({
        action: 'submitFeedback',
        items: [`限流反馈 ${attempt}`],
        contact: '',
        page: 'creation',
        appVersion: '1.10.0',
        deviceLabel: 'Feedback Test',
        deviceInstanceId: creationDeviceId,
      }),
      `feedback before limit ${attempt}`,
    )
  }
  expectError(
    await invoke({
      action: 'submitFeedback',
      items: ['应被限流'],
      contact: '',
      page: 'creation',
      appVersion: '1.10.0',
      deviceLabel: 'Feedback Test',
      deviceInstanceId: creationDeviceId,
    }),
    'FEEDBACK_RATE_LIMITED',
  )

  const inbox = ok(
    await invoke({
      action: 'adminListFeedback',
      adminKey: 'test-admin-key',
    }),
    'admin feedback list',
  )
  if (inbox.entries.length < 4 || inbox.unreadCount !== inbox.entries.length) {
    throw new Error('Feedback inbox counts are incorrect')
  }
  const roomFeedback = inbox.entries.find((entry) => entry.id === settingsFeedback.id)
  if (!roomFeedback || roomFeedback.roomName !== `反馈测试${suffix}`) {
    throw new Error('Authenticated feedback did not attach room context')
  }

  ok(
    await invoke({
      action: 'adminUpdateFeedback',
      adminKey: 'test-admin-key',
      feedbackId: settingsFeedback.id,
      feedbackAction: 'read',
    }),
    'mark feedback read',
  )
  const afterRead = ok(
    await invoke({
      action: 'adminListFeedback',
      adminKey: 'test-admin-key',
    }),
    'feedback after read',
  )
  if (
    afterRead.entries.find((entry) => entry.id === settingsFeedback.id)?.status !==
    'read'
  ) {
    throw new Error('Feedback read status did not persist')
  }

  ok(
    await invoke({
      action: 'adminUpdateFeedback',
      adminKey: 'test-admin-key',
      feedbackId: firstFeedback.id,
      feedbackAction: 'delete',
    }),
    'delete feedback',
  )
  if (
    database.data
      .get('feedbackEntries')
      .some((entry) => entry._id === firstFeedback.id)
  ) {
    throw new Error('Feedback was not deleted')
  }

  console.log(
    JSON.stringify(
      {
        publicConfig: true,
        feedbackBarkConfigured: true,
        anonymousFeedback: true,
        authenticatedRoomContext: true,
        contactHiddenFromBark: true,
        feedbackRateLimited: true,
        adminInbox: true,
        readAndDelete: true,
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
