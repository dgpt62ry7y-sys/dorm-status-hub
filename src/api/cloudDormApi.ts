import { DORMSYNC_API_URL } from '../config/cloudbase'
import type {
  DeviceLinkResult,
  DeviceListResult,
  DormState,
  DormStatus,
  NotificationSettings,
  RevokeDeviceResult,
  RoomCapacity,
  StatusUpdate,
} from '../types/dorm'

interface ApiSuccess<T> {
  ok: true
  data: T
}

interface ApiFailure {
  ok: false
  error: {
    code: string
    message: string
  }
}

export interface SessionResult {
  memberToken: string
  recoveryCode?: string
  state: DormState
}

export class CloudApiError extends Error {
  code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'CloudApiError'
    this.code = code
  }
}

const API_TIMEOUT_MS = 12_000

async function callApi<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), API_TIMEOUT_MS)
  let response: Response
  try {
    response = await fetch(DORMSYNC_API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        action,
        ...payload,
      }),
      signal: controller.signal,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new CloudApiError('NETWORK_TIMEOUT', '连接宿舍服务超时，请稍后重试')
    }
    throw new CloudApiError(
      'NETWORK_UNREACHABLE',
      '无法连接宿舍服务。请检查网络；如果使用 CloudBase 默认测试域名，请先完成服务域名确认',
    )
  } finally {
    window.clearTimeout(timeout)
  }

  const responseText = await response.text()
  let result: ApiSuccess<T> | ApiFailure
  try {
    result = JSON.parse(responseText) as ApiSuccess<T> | ApiFailure
  } catch {
    throw new CloudApiError(
      'INVALID_API_RESPONSE',
      '宿舍服务返回了异常页面，请确认 API 地址正确且测试域名已经确认',
    )
  }

  if (!result) {
    throw new CloudApiError(
      'EMPTY_RESPONSE',
      '云端服务没有返回结果',
    )
  }
  if (!result.ok) {
    throw new CloudApiError(result.error.code, result.error.message)
  }
  if (!response.ok) {
    throw new CloudApiError(
      'INVALID_API_RESPONSE',
      `宿舍服务返回异常状态 HTTP ${response.status}`,
    )
  }
  return result.data
}

export const cloudDormApi = {
  createRoom(input: {
    roomName: string
    nickname: string
    deviceLabel: string
    capacity: RoomCapacity
    creatorKey: string
  }) {
    return callApi<SessionResult>('createRoom', input)
  },

  joinRoom(input: { inviteCode: string; nickname: string; deviceLabel: string }) {
    return callApi<SessionResult>('joinRoom', input)
  },

  claimDeviceLink(input: { code: string; deviceLabel: string }) {
    return callApi<SessionResult>('claimDeviceLink', input)
  },

  recoverAccount(input: { recoveryCode: string; deviceLabel: string }) {
    return callApi<SessionResult>('recoverAccount', input)
  },

  getState(
    memberToken: string,
    claimCapacityNotice = false,
    claimReleaseNotice = false,
  ) {
    return callApi<DormState>('getState', {
      memberToken,
      claimCapacityNotice,
      claimReleaseNotice,
    })
  },

  updateStatus(memberToken: string, update: StatusUpdate) {
    return callApi<DormState>('updateStatus', {
      memberToken,
      ...update,
    })
  },

  updateProfile(
    memberToken: string,
    input: { nickname: string; defaultStatus: DormStatus },
  ) {
    return callApi<DormState>('updateProfile', {
      memberToken,
      ...input,
    })
  },

  regenerateInvite(memberToken: string) {
    return callApi<{ inviteCode: string; state: DormState }>('regenerateInvite', {
      memberToken,
    })
  },

  removeMember(memberToken: string, memberId: string) {
    return callApi<DormState>('removeMember', {
      memberToken,
      memberId,
    })
  },

  leaveRoom(memberToken: string) {
    return callApi<{ left: true }>('leaveRoom', { memberToken })
  },

  createDeviceLink(memberToken: string) {
    return callApi<DeviceLinkResult>('createDeviceLink', { memberToken })
  },

  listDevices(memberToken: string) {
    return callApi<DeviceListResult>('listDevices', { memberToken })
  },

  revokeDevice(memberToken: string, deviceId: string) {
    return callApi<RevokeDeviceResult>('revokeDevice', { memberToken, deviceId })
  },

  rotateRecoveryCode(memberToken: string) {
    return callApi<{ recoveryCode: string }>('rotateRecoveryCode', { memberToken })
  },

  updateRoomCapacity(memberToken: string, capacity: RoomCapacity) {
    return callApi<DormState>('updateRoomCapacity', { memberToken, capacity })
  },

  acknowledgeCapacityNotice(memberToken: string, noticeId: string) {
    return callApi<{ acknowledged: true }>('acknowledgeCapacityNotice', {
      memberToken,
      noticeId,
    })
  },

  acknowledgeReleaseNotice(memberToken: string, noticeId: string) {
    return callApi<{ acknowledged: true }>('acknowledgeReleaseNotice', {
      memberToken,
      noticeId,
    })
  },

  verifyExistingRoom(memberToken: string, creatorKey: string) {
    return callApi<DormState>('verifyExistingRoom', {
      memberToken,
      creatorKey,
    })
  },

  getNotificationSettings(memberToken: string) {
    return callApi<NotificationSettings>('getNotificationSettings', {
      memberToken,
    })
  },

  rotateNotificationTopic(memberToken: string) {
    return callApi<NotificationSettings>('rotateNotificationTopic', {
      memberToken,
    })
  },

  sendTestNotification(memberToken: string) {
    return callApi<{ sent: true; sentAt: string }>('sendTestNotification', {
      memberToken,
    })
  },
}
