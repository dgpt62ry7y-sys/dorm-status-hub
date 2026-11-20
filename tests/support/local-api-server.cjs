const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const {
  createMemoryDatabase,
  installCloudBaseMock,
} = require('./memory-cloudbase.cjs')

const port = Number(process.argv[2] || 8787)
const root = path.join(__dirname, '..', '..')
try {
  const envText = fs.readFileSync(path.join(root, '.env.local'), 'utf8')
  for (const line of envText.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const separator = trimmed.indexOf('=')
    if (separator < 1) continue
    const key = trimmed.slice(0, separator).trim()
    const value = trimmed.slice(separator + 1).trim()
    if (!process.env[key]) process.env[key] = value
  }
} catch {
  // Automated tests can run without a local environment file.
}
process.env.DORMSYNC_CREATOR_KEY ||= 'test-creator-key'
process.env.DORMSYNC_ADMIN_KEY ||= 'test-admin-key'
const database = createMemoryDatabase()
let notificationInbox = []
let notificationSequence = 0
let notificationModes = {
  ntfy: 'mock',
  bark: 'mock',
}
const nativeFetch = global.fetch.bind(global)
global.fetch = async (url, options = {}) => {
  if (String(url) === 'https://api.day.app/push') {
    let payload = {}
    try {
      payload = JSON.parse(String(options.body || '{}'))
    } catch {
      // The real Bark service rejects malformed JSON.
    }
    const deviceKeys = Array.isArray(payload.device_keys) ? payload.device_keys : []
    if (notificationModes.bark === 'real') {
      const realResponse = await nativeFetch(url, options)
      notificationSequence += 1
      notificationInbox.unshift({
        id: notificationSequence,
        channel: 'bark',
        title: String(payload.title || ''),
        priority: String(payload.level || ''),
        body: String(payload.body || ''),
        receivedAt: new Date().toISOString(),
        deviceCount: deviceKeys.length,
        delivery: 'real',
        delivered: realResponse.ok,
      })
      return realResponse
    }
    notificationSequence += 1
    notificationInbox.unshift({
      id: notificationSequence,
      channel: 'bark',
      title: String(payload.title || ''),
      priority: String(payload.level || ''),
      body: String(payload.body || ''),
      receivedAt: new Date().toISOString(),
      deviceCount: deviceKeys.length,
      delivery: 'mock',
      delivered: true,
    })
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          code: 200,
          message: 'success',
          data: deviceKeys.map(() => ({ code: 200 })),
        }
      },
      async text() {
        return '{"code":200,"message":"success"}'
      },
    }
  }
  return nativeFetch(url, options)
}
const restoreCloudBase = installCloudBaseMock(database)
const backend = require(path.join(__dirname, '..', '..', 'cloudfunctions', 'api', 'index.js'))
restoreCloudBase()

function resetDatabase() {
  for (const rows of database.data.values()) rows.splice(0, rows.length)
  notificationInbox = []
  notificationModes = { ntfy: 'mock', bark: 'mock' }
}

async function invokeBackend(payload) {
  const result = await backend.main({
    httpMethod: 'POST',
    body: JSON.stringify({
      ...payload,
      clientIp: payload.clientIp || 'local-test',
    }),
  })
  const parsed = JSON.parse(result.body)
  if (!parsed.ok) {
    const error = new Error(parsed.error.message)
    error.code = parsed.error.code
    throw error
  }
  return parsed.data
}

function sendJson(response, data, status = 200) {
  response.writeHead(status, {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'content-type': 'application/json',
  })
  response.end(JSON.stringify(data))
}

const server = http.createServer(async (request, response) => {
  const cors = {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
  }

  if (request.method === 'OPTIONS') {
    response.writeHead(204, cors)
    response.end()
    return
  }

  if (request.method === 'GET' && request.url === '/health') {
    response.writeHead(200, { ...cors, 'content-type': 'application/json' })
    response.end(JSON.stringify({ ok: true }))
    return
  }

  let body = ''
  for await (const chunk of request) body += chunk
  let payload = {}
  try {
    payload = body ? JSON.parse(body) : {}
  } catch {
    // The real backend handles malformed request bodies.
  }

  if (String(request.url || '').startsWith('/ntfy/')) {
    const titleHeader = String(request.headers.title || '')
    const titleMatch = /^=\?UTF-8\?B\?(.+)\?=$/i.exec(titleHeader)
    const title = titleMatch
      ? Buffer.from(titleMatch[1], 'base64').toString('utf8')
      : titleHeader
    const topic = decodeURIComponent(String(request.url).slice('/ntfy/'.length))
    if (notificationModes.ntfy === 'real') {
      let realStatus = 200
      let delivered = true
      try {
        const forwarded = await nativeFetch(`https://ntfy.sh/${encodeURIComponent(topic)}`, {
          method: request.method,
          headers: {
            'content-type': String(
              request.headers['content-type'] || 'text/plain; charset=utf-8',
            ),
            title: String(request.headers.title || ''),
            priority: String(request.headers.priority || ''),
            tags: String(request.headers.tags || ''),
          },
          body,
        })
        realStatus = forwarded.status
        delivered = forwarded.ok
      } catch {
        realStatus = 502
        delivered = false
      }
      notificationSequence += 1
      notificationInbox.unshift({
        id: notificationSequence,
        channel: 'ntfy',
        title,
        priority: String(request.headers.priority || ''),
        body,
        receivedAt: new Date().toISOString(),
        delivery: 'real',
        delivered,
      })
      sendJson(
        response,
        { id: `local-${notificationSequence}`, delivered },
        delivered ? realStatus : 502,
      )
      return
    }
    notificationSequence += 1
    notificationInbox.unshift({
      id: notificationSequence,
      channel: 'ntfy',
      title,
      priority: String(request.headers.priority || ''),
      body,
      receivedAt: new Date().toISOString(),
      delivery: 'mock',
      delivered: true,
    })
    sendJson(response, { id: `local-${notificationSequence}` })
    return
  }

  if (payload.action === '__testResetReleaseNotice') {
    const tokenHash = crypto
      .createHash('sha256')
      .update(String(payload.memberToken || ''))
      .digest('hex')
    const session = database.data
      .get('deviceSessions')
      .find((item) => item.tokenHash === tokenHash && item.active)
    const member = session
      ? database.data.get('members').find((item) => item._id === session.memberId)
      : null
    if (member) {
      member.lastSeenReleaseVersion = payload.lastSeenVersion || '1.2.0'
      const claims = database.data.get('releaseClaims')
      for (let index = claims.length - 1; index >= 0; index -= 1) {
        if (claims[index].memberId === member._id) claims.splice(index, 1)
      }
    }
    sendJson(response, {
      ok: Boolean(member),
      data: { reset: Boolean(member) },
    })
    return
  }

  if (payload.action === '__testResetAll') {
    resetDatabase()
    sendJson(response, { ok: true, data: { reset: true } })
    return
  }

  if (payload.action === '__testGetNotificationInbox') {
    sendJson(response, {
      ok: true,
      data: { messages: notificationInbox, modes: notificationModes },
    })
    return
  }

  if (payload.action === '__testSetNotificationMode') {
    const channel = String(payload.channel || '')
    const mode = String(payload.mode || '')
    if (
      !Object.hasOwn(notificationModes, channel) ||
      !['mock', 'real'].includes(mode)
    ) {
      sendJson(
        response,
        {
          ok: false,
          error: { code: 'INVALID_MODE', message: '通知模式无效' },
        },
        400,
      )
      return
    }
    notificationModes[channel] = mode
    sendJson(response, { ok: true, data: { modes: notificationModes } })
    return
  }

  if (payload.action === '__testClearNotificationInbox') {
    notificationInbox = []
    sendJson(response, { ok: true, data: { cleared: true } })
    return
  }

  if (payload.action === '__testMakeRoomLegacy') {
    const tokenHash = crypto
      .createHash('sha256')
      .update(String(payload.memberToken || ''))
      .digest('hex')
    const session = database.data
      .get('deviceSessions')
      .find((item) => item.tokenHash === tokenHash && item.active)
    const member = session
      ? database.data.get('members').find((item) => item._id === session.memberId)
      : null
    const room = member
      ? database.data.get('rooms').find((item) => item._id === member.roomId)
      : null
    if (room) {
      delete room.verificationStatus
      delete room.creatorKeyVerifiedAt
      delete room.verificationPromptedAt
      delete room.verificationDeadlineAt
      delete room.verificationFallbackAt
    }
    sendJson(response, { ok: Boolean(room), data: { legacy: Boolean(room) } })
    return
  }

  if (payload.action === '__testInitializeSixRoom') {
    resetDatabase()
    try {
      const created = await invokeBackend({
        action: 'createRoom',
        roomName: '本地六人测试宿舍',
        nickname: '测试成员 1',
        capacity: 6,
        creatorKey: process.env.DORMSYNC_CREATOR_KEY,
        deviceLabel: 'Local Test · Account 1',
      })
      const accounts = [
        {
          memberId: created.state.currentMemberId,
          nickname: '测试成员 1',
          memberToken: created.memberToken,
          recoveryCode: created.recoveryCode,
        },
      ]
      for (let index = 2; index <= 6; index += 1) {
        const joined = await invokeBackend({
          action: 'joinRoom',
          inviteCode: created.state.room.inviteCode,
          nickname: `测试成员 ${index}`,
          deviceLabel: `Local Test · Account ${index}`,
        })
        accounts.push({
          memberId: joined.state.currentMemberId,
          nickname: `测试成员 ${index}`,
          memberToken: joined.memberToken,
          recoveryCode: joined.recoveryCode,
        })
      }
      for (const account of accounts) {
        const tokenHash = crypto
          .createHash('sha256')
          .update(account.memberToken)
          .digest('hex')
        const session = database.data
          .get('deviceSessions')
          .find((item) => item.tokenHash === tokenHash && item.active)
        const member = session
          ? database.data.get('members').find((item) => item._id === session.memberId)
          : null
        if (member) {
          member.lastSeenReleaseVersion = '0.0.0'
          const claims = database.data.get('releaseClaims')
          for (let claimIndex = claims.length - 1; claimIndex >= 0; claimIndex -= 1) {
            if (claims[claimIndex].memberId === member._id) {
              claims.splice(claimIndex, 1)
            }
          }
        }
      }
      sendJson(response, {
        ok: true,
        data: {
          roomId: created.state.room.id,
          inviteCode: created.state.room.inviteCode,
          accounts,
        },
      })
    } catch (error) {
      sendJson(
        response,
        {
          ok: false,
          error: {
            code: error.code || 'TEST_SETUP_FAILED',
            message: error.message,
          },
        },
        500,
      )
    }
    return
  }

  const result = await backend.main({
    httpMethod: request.method,
    body,
  })
  response.writeHead(result.statusCode || 200, {
    ...cors,
    ...result.headers,
  })
  response.end(result.body)
})

server.listen(port, '127.0.0.1', () => {
  console.log(JSON.stringify({ listening: `http://127.0.0.1:${port}` }))
})
