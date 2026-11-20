import { computed, reactive, ref } from 'vue'
import { CloudApiError, cloudDormApi } from '../api/cloudDormApi'
import type {
  CapacityNotice,
  DeviceLinkResult,
  DeviceSession,
  DormState,
  DormStatus,
  RoomCapacity,
  StatusUpdate,
} from '../types/dorm'
import { getDeviceLabel } from '../utils/device'

export type StorePhase = 'loading' | 'onboarding' | 'ready' | 'error'

export interface SecretDialogState {
  title: string
  description: string
  code: string
  required: boolean
}

const TOKEN_KEY = 'dormsync:member-token:v1'
const POLL_INTERVAL_MS = 5000

function createEmptyState(): DormState {
  return {
    room: {
      id: '',
      name: '宿舍空间',
      inviteCode: '',
      ownerId: '',
      capacity: 4,
      memberCount: 0,
    },
    currentMemberId: '',
    currentDeviceId: '',
    members: [],
    statuses: [],
    preferences: {
      defaultStatus: 'normal',
    },
  }
}

const state = reactive<DormState>(createEmptyState())
const phase = ref<StorePhase>('loading')
const memberToken = ref(localStorage.getItem(TOKEN_KEY) || '')
const actionError = ref('')
const isOnline = ref(navigator.onLine)
const isSyncing = ref(false)
const lastSyncedAt = ref<string | null>(null)
const devices = ref<DeviceSession[]>([])
const devicesLoading = ref(false)
const secretDialog = ref<SecretDialogState | null>(null)
const capacityNoticeDialog = ref<CapacityNotice | null>(null)

let pollTimer: number | undefined
let refreshInFlight: Promise<void> | null = null
let devicesRequestInFlight: Promise<void> | null = null
let lifecycleBound = false
let initialized = false

function applyState(next: DormState): void {
  state.room = next.room
  state.currentMemberId = next.currentMemberId
  state.currentDeviceId = next.currentDeviceId || ''
  state.members = next.members
  state.statuses = next.statuses
  state.preferences = next.preferences
  lastSyncedAt.value = new Date().toISOString()
  if (next.capacityNotice) capacityNoticeDialog.value = next.capacityNotice
}

function saveSession(token: string, next: DormState): void {
  memberToken.value = token
  localStorage.setItem(TOKEN_KEY, token)
  applyState(next)
  phase.value = 'ready'
  actionError.value = ''
  startPolling()
}

function clearSession(): void {
  memberToken.value = ''
  localStorage.removeItem(TOKEN_KEY)
  Object.assign(state, createEmptyState())
  phase.value = 'onboarding'
  lastSyncedAt.value = null
  devices.value = []
  secretDialog.value = null
  capacityNoticeDialog.value = null
  stopPolling()
}

function formatRecoveryCode(code: string): string {
  return code.match(/.{1,4}/g)?.join('-') ?? code
}

function showRecoveryCode(code: string, required = false): void {
  secretDialog.value = {
    title: required ? '保存你的账号恢复码' : '新的账号恢复码',
    description: required
      ? '这是旧设备丢失后找回账号的唯一长期凭证。请保存到微信收藏或其他安全位置。'
      : '旧恢复码已经失效。请用新恢复码替换之前保存的版本。',
    code: formatRecoveryCode(code),
    required,
  }
}

function dismissSecretDialog(): void {
  if (secretDialog.value?.required) return
  secretDialog.value = null
}

function confirmSecretDialog(): void {
  secretDialog.value = null
}

function startPolling(): void {
  stopPolling()
  pollTimer = window.setInterval(() => {
    if (document.visibilityState === 'visible' && phase.value === 'ready') {
      void refresh(true)
    }
  }, POLL_INTERVAL_MS)
}

function stopPolling(): void {
  if (pollTimer) window.clearInterval(pollTimer)
  pollTimer = undefined
}

function bindLifecycle(): void {
  if (lifecycleBound) return
  lifecycleBound = true

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && memberToken.value) {
      void refresh(true, true)
    }
  })

  window.addEventListener('online', () => {
    isOnline.value = true
    if (memberToken.value) void refresh(true, true)
  })
  window.addEventListener('offline', () => {
    isOnline.value = false
  })
}

async function refresh(silent = true, claimCapacityNotice = false): Promise<void> {
  if (!memberToken.value || phase.value !== 'ready') return
  if (refreshInFlight) return refreshInFlight

  isSyncing.value = true
  refreshInFlight = (async () => {
    try {
      const next = await cloudDormApi.getState(memberToken.value, claimCapacityNotice)
      applyState(next)
      isOnline.value = true
      if (!silent) actionError.value = ''
    } catch (error) {
      if (error instanceof CloudApiError && error.code === 'AUTH_REQUIRED') {
        clearSession()
        actionError.value = error.message
        return
      }
      isOnline.value = false
      if (!silent) {
        actionError.value =
          error instanceof Error ? error.message : '同步失败，请稍后重试'
      }
    } finally {
      isSyncing.value = false
      refreshInFlight = null
    }
  })()

  return refreshInFlight
}

async function initialize(): Promise<void> {
  if (initialized) return
  initialized = true
  bindLifecycle()

  if (!memberToken.value) {
    phase.value = 'onboarding'
    return
  }

  try {
    const next = await cloudDormApi.getState(memberToken.value, true)
    applyState(next)
    phase.value = 'ready'
    isOnline.value = true
    startPolling()
  } catch (error) {
    if (error instanceof CloudApiError && error.code === 'AUTH_REQUIRED') {
      clearSession()
      return
    }
    phase.value = 'error'
    isOnline.value = false
    actionError.value =
      error instanceof Error ? error.message : '无法连接到宿舍服务'
  }
}

async function retryInitialize(): Promise<void> {
  initialized = false
  phase.value = 'loading'
  actionError.value = ''
  await initialize()
}

async function createRoom(
  roomName: string,
  nickname: string,
  capacity: RoomCapacity,
): Promise<void> {
  const result = await cloudDormApi.createRoom({
    roomName,
    nickname,
    deviceLabel: getDeviceLabel(),
    capacity,
  })
  saveSession(result.memberToken, result.state)
  if (result.recoveryCode) showRecoveryCode(result.recoveryCode, true)
}

async function joinRoom(inviteCode: string, nickname: string): Promise<void> {
  const result = await cloudDormApi.joinRoom({
    inviteCode,
    nickname,
    deviceLabel: getDeviceLabel(),
  })
  saveSession(result.memberToken, result.state)
  if (result.recoveryCode) showRecoveryCode(result.recoveryCode, true)
}

async function linkDevice(code: string): Promise<void> {
  const result = await cloudDormApi.claimDeviceLink({
    code,
    deviceLabel: getDeviceLabel(),
  })
  saveSession(result.memberToken, result.state)
}

async function recoverAccount(recoveryCode: string): Promise<void> {
  const result = await cloudDormApi.recoverAccount({
    recoveryCode,
    deviceLabel: getDeviceLabel(),
  })
  saveSession(result.memberToken, result.state)
}

async function saveStatus(update: StatusUpdate): Promise<void> {
  const next = await cloudDormApi.updateStatus(memberToken.value, update)
  applyState(next)
  isOnline.value = true
}

async function updateNickname(nickname: string): Promise<void> {
  const next = await cloudDormApi.updateProfile(memberToken.value, {
    nickname,
    defaultStatus: state.preferences.defaultStatus,
  })
  applyState(next)
}

async function saveProfile(nickname: string, defaultStatus: DormStatus): Promise<void> {
  const next = await cloudDormApi.updateProfile(memberToken.value, {
    nickname,
    defaultStatus,
  })
  applyState(next)
}

async function updateDefaultStatus(status: DormStatus): Promise<void> {
  const currentMember = state.members.find((item) => item.id === state.currentMemberId)
  const next = await cloudDormApi.updateProfile(memberToken.value, {
    nickname: currentMember?.nickname || '室友',
    defaultStatus: status,
  })
  applyState(next)
}

async function loadDevices(): Promise<void> {
  if (!memberToken.value) return
  if (devicesRequestInFlight) return devicesRequestInFlight

  devicesLoading.value = true
  devicesRequestInFlight = (async () => {
    try {
      const result = await cloudDormApi.listDevices(memberToken.value)
      devices.value = result.devices
      state.currentDeviceId = result.currentDeviceId
    } catch (error) {
      if (error instanceof CloudApiError && error.code === 'AUTH_REQUIRED') {
        clearSession()
        return
      }
      throw error
    } finally {
      devicesLoading.value = false
      devicesRequestInFlight = null
    }
  })()
  return devicesRequestInFlight
}

async function createDeviceLink(): Promise<DeviceLinkResult> {
  const result = await cloudDormApi.createDeviceLink(memberToken.value)
  return result
}

async function revokeDevice(deviceId: string): Promise<boolean> {
  const result = await cloudDormApi.revokeDevice(memberToken.value, deviceId)
  if (result.revokedCurrent) {
    clearSession()
    return true
  }
  devices.value = result.devices
  state.currentDeviceId = result.currentDeviceId
  return false
}

async function unlinkCurrentDevice(): Promise<void> {
  if (!state.currentDeviceId) await loadDevices()
  const current =
    devices.value.find((device) => device.id === state.currentDeviceId) ??
    devices.value.find((device) => device.isCurrent)
  if (!current) {
    clearSession()
    return
  }
  await revokeDevice(current.id)
}

async function rotateRecoveryCode(): Promise<void> {
  const result = await cloudDormApi.rotateRecoveryCode(memberToken.value)
  showRecoveryCode(result.recoveryCode)
}

async function updateRoomCapacity(capacity: RoomCapacity): Promise<void> {
  const next = await cloudDormApi.updateRoomCapacity(memberToken.value, capacity)
  applyState(next)
}

async function acknowledgeCapacityNotice(noticeId: string): Promise<void> {
  await cloudDormApi.acknowledgeCapacityNotice(memberToken.value, noticeId)
  capacityNoticeDialog.value = null
}

async function regenerateInvite(): Promise<string> {
  const result = await cloudDormApi.regenerateInvite(memberToken.value)
  applyState(result.state)
  return result.inviteCode
}

async function removeMember(memberId: string): Promise<void> {
  const next = await cloudDormApi.removeMember(memberToken.value, memberId)
  applyState(next)
}

async function leaveRoom(): Promise<void> {
  await cloudDormApi.leaveRoom(memberToken.value)
  clearSession()
}

export function useDormStore() {
  const currentMember = computed(() =>
    state.members.find((member) => member.id === state.currentMemberId),
  )
  const memberCount = computed(() => state.members.length)
  const availableSeats = computed(() =>
    Math.max(0, state.room.capacity - state.members.length),
  )
  const isOwner = computed(() => state.room.ownerId === state.currentMemberId)

  return {
    state,
    phase,
    actionError,
    isOnline,
    isSyncing,
    lastSyncedAt,
    devices,
    devicesLoading,
    secretDialog,
    capacityNoticeDialog,
    currentMember,
    memberCount,
    availableSeats,
    isOwner,
    initialize,
    retryInitialize,
    refresh,
    createRoom,
    joinRoom,
    linkDevice,
    recoverAccount,
    saveStatus,
    saveProfile,
    updateNickname,
    updateDefaultStatus,
    regenerateInvite,
    removeMember,
    leaveRoom,
    loadDevices,
    createDeviceLink,
    revokeDevice,
    unlinkCurrentDevice,
    rotateRecoveryCode,
    updateRoomCapacity,
    acknowledgeCapacityNotice,
    dismissSecretDialog,
    confirmSecretDialog,
    clearSession,
  }
}
