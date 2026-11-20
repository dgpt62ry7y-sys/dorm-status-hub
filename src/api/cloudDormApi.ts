import { DORMSYNC_API_URL } from '../config/cloudbase'
import type {
  DeviceLinkResult,
  DeviceListResult,
  DormState,
  DormStatus,
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

async function callApi<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const response = await fetch(DORMSYNC_API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      action,
      ...payload,
    }),
  })

  const result = (await response.json()) as ApiSuccess<T> | ApiFailure
  if (!result) {
    throw new CloudApiError(
      'EMPTY_RESPONSE',
      '云端服务没有返回结果',
    )
  }
  if (!result.ok) {
    throw new CloudApiError(result.error.code, result.error.message)
  }
  return result.data
}

export const cloudDormApi = {
  createRoom(input: {
    roomName: string
    nickname: string
    deviceLabel: string
    capacity: RoomCapacity
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

  getState(memberToken: string, claimCapacityNotice = false) {
    return callApi<DormState>('getState', { memberToken, claimCapacityNotice })
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
}
