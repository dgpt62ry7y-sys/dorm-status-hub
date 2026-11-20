const http = require('node:http')
const { main } = require('./index')

const server = http.createServer((request, response) => {
  const chunks = []

  request.on('data', (chunk) => chunks.push(chunk))
  request.on('end', async () => {
    try {
      const body = Buffer.concat(chunks).toString('utf8')
      const result = await main({
        httpMethod: request.method,
        headers: request.headers,
        body,
        requestContext: {
          http: {
            method: request.method,
            path: request.url,
          },
        },
      })
      response.writeHead(result.statusCode || 200, result.headers || {})
      response.end(result.body || '')
    } catch (error) {
      console.error(error)
      response.writeHead(500, {
        'content-type': 'application/json; charset=utf-8',
      })
      response.end(
        JSON.stringify({
          ok: false,
          error: {
            code: 'INTERNAL_ERROR',
            message: '服务暂时不可用，请稍后重试',
          },
        }),
      )
    }
  })
})

server.listen(9000, '0.0.0.0', () => {
  console.log('DormSync HTTP function listening on 0.0.0.0:9000')
})
