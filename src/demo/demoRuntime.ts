import {
  DEMO_NOTIFICATION_EVENT,
  DemoApiError,
  DemoDormService,
  type DemoAccount,
  type DemoNotification,
} from './DemoDormService'
export type { DemoAccount, DemoNotification } from './DemoDormService'

const TOKEN_KEY = 'dormsync:member-token:v1'
const LOCAL_RECOVERY_KEY = 'dormsync:local-test-recovery-code:v1'

let service = new DemoDormService()
let installed = false

function responseJson(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

export function installDemoRuntime(): void {
  if (installed) return
  installed = true
  const nativeFetch = window.fetch.bind(window)

  window.fetch = async (input, init) => {
    const rawUrl =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url
    const path = new URL(rawUrl, window.location.href).pathname
    if (path !== '/demo-api') return nativeFetch(input, init)

    let payload: Record<string, unknown> = {}
    try {
      payload = JSON.parse(String(init?.body || '{}'))
    } catch {
      return responseJson(
        {
          ok: false,
          error: { code: 'INVALID_REQUEST', message: '请求格式不正确' },
        },
        400,
      )
    }

    try {
      const data = service.dispatch(String(payload.action || ''), payload)
      return responseJson({ ok: true, data })
    } catch (error) {
      if (error instanceof DemoApiError) {
        return responseJson(
          { ok: false, error: { code: error.code, message: error.message } },
          200,
        )
      }
      return responseJson(
        {
          ok: false,
          error: { code: 'INTERNAL_ERROR', message: '体验版操作失败，请重置后重试' },
        },
        200,
      )
    }
  }

  localStorage.removeItem(LOCAL_RECOVERY_KEY)
  localStorage.removeItem('dormsync:notification-topic-seen:v1')
  localStorage.removeItem('dormsync:notification-nudge-dismissed:v1')
  localStorage.setItem(TOKEN_KEY, service.getFirstToken())
}

export function getDemoService(): DemoDormService {
  return service
}

export function getDemoAccounts(): DemoAccount[] {
  return service.getAccounts()
}

export function getDemoNotifications(): DemoNotification[] {
  return service.getNotifications()
}

export function clearDemoNotifications(): void {
  service.clearNotifications()
}

export function resetDemo(): { accounts: DemoAccount[]; token: string } {
  service.reset()
  const token = service.getFirstToken()
  localStorage.setItem(TOKEN_KEY, token)
  return { accounts: service.getAccounts(), token }
}

export { DEMO_NOTIFICATION_EVENT }
