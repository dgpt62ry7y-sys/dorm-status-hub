const http = require('node:http')
const path = require('node:path')
const crypto = require('node:crypto')
const {
  createMemoryDatabase,
  installCloudBaseMock,
} = require('./memory-cloudbase.cjs')

const port = Number(process.argv[2] || 8787)
const database = createMemoryDatabase()
const restoreCloudBase = installCloudBaseMock(database)
const backend = require(path.join(__dirname, '..', '..', 'cloudfunctions', 'api', 'index.js'))
restoreCloudBase()

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
    response.writeHead(200, { ...cors, 'content-type': 'application/json' })
    response.end(
      JSON.stringify({
        ok: Boolean(member),
        data: { reset: Boolean(member) },
      }),
    )
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
