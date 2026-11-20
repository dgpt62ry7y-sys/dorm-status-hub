import { computed, reactive, ref } from 'vue'
import { CloudApiError, cloudDormApi } from '../api/cloudDormApi'
import type {
  CapacityNotice,
  DeviceLinkResult,
  DeviceSession,
  DormState,
  DormStatus,
  ReleaseNotice,
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
const NOTIFICATION_TOPIC_SEEN_KEY = 'dormsync:notification-topic-seen:v1'
const LOCAL_RECOVERY_CODE_KEY = 'dormsync:local-test-recovery-code:v1'
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
    serverVersion: '',
    roomVerification: null,
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
const releaseNoticeDialog = ref<ReleaseNotice | null>(null)
const initialServerVersion = ref('')
const notificationTopicUpdateAvailable = ref(false)

let pollTimer: number | undefined
let refreshInFlight: Promise<void> | null = null
let devicesRequestInFlight: Promise<void> | null = null
let lifecycleBound = false
let initialized = false
let lastFocusRetryAt = 0

function applyState(next: DormState): void {
  state.room = next.room
  const topicUpdatedAt = next.room.notificationTopicUpdatedAt
  const seenTopicUpdatedAt = localStorage.getItem(NOTIFICATION_TOPIC_SEEN_KEY)
  const topicTimestamp = topicUpdatedAt ? Date.parse(topicUpdatedAt) : Number.NaN
  const seenTimestamp = seenTopicUpdatedAt
    ? Date.parse(seenTopicUpdatedAt)
    : Number.NaN
  notificationTopicUpdateAvailable.value = Boolean(
    !Number.isFinite(topicTimestamp) ||
      !Number.isFinite(seenTimestamp) ||
      topicTimestamp > seenTimestamp,
  )
  state.currentMemberId = next.currentMemberId
  state.currentDeviceId = next.currentDeviceId || ''
  state.serverVersion = next.serverVersion || ''
  state.roomVerification = next.roomVerification || null
  state.members = next.members
  state.statuses = next.statuses
  state.preferences = next.preferences
  lastSyncedAt.value = new Date().toISOString()
  if (next.capacityNotice) capacityNoticeDialog.value = next.capacityNotice
  if (next.releaseNotice) releaseNoticeDialog.value = next.releaseNotice
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
  releaseNoticeDialog.value = null
  initialServerVersion.value = ''
  notificationTopicUpdateAvailable.value = false
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

function compareVersions(left: string, right: string): number {
  const leftParts = left.split('.').map(Number)
  const rightParts = right.split('.').map(Number)
  for (let index = 0; index < 3; index += 1) {
    const difference = (leftParts[index] || 0) - (rightParts[index] || 0)
    if (difference !== 0) return difference
  }
  return 0
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
      void refresh(true, true, true)
    }
  })

  window.addEventListener('online', () => {
    isOnline.value = true
    if (memberToken.value) void refresh(true, true, true)
  })
  window.addEventListener('offline', () => {
    isOnline.value = false
  })
  window.addEventListener('focus', () => {
    if (
      phase.value === 'error' &&
      memberToken.value &&
      Date.now() - lastFocusRetryAt > 4_000
    ) {
      lastFocusRetryAt = Date.now()
      void retryInitialize()
    }
  })
}

function isTransientNetworkError(error: unknown): boolean {
  return (
    error instanceof CloudApiError &&
    ['NETWORK_UNREACHABLE', 'NETWORK_TIMEOUT', 'INVALID_API_RESPONSE'].includes(error.code)
  )
}

async function getInitialState(memberTokenValue: string): Promise<DormState> {
  const retryDelays = [500, 1_300]
  let lastError: unknown

  for (let attempt = 0; attempt <= retryDelays.length; attempt += 1) {
    try {
      return await cloudDormApi.getState(memberTokenValue, true, true)
    } catch (error) {
      lastError = error
      if (!isTransientNetworkError(error) || attempt === retryDelays.length) {
        throw error
      }
      await new Promise((resolve) => window.setTimeout(resolve, retryDelays[attempt]))
    }
  }

  throw lastError
}

async function refresh(
  silent = true,
  claimCapacityNotice = false,
  claimReleaseNotice = false,
): Promise<void> {
  if (!memberToken.value || phase.value !== 'ready') return
  if (refreshInFlight) return refreshInFlight

  isSyncing.value = true
  refreshInFlight = (async () => {
    try {
      const next = await cloudDormApi.getState(
        memberToken.value,
        claimCapacityNotice,
        claimReleaseNotice,
      )
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
    const next = await getInitialState(memberToken.value)
    applyState(next)
    initialServerVersion.value = next.serverVersion || ''
    phase.value = 'ready'
    isOnline.value = true
    startPolling()
    const pendingRecoveryCode = localStorage.getItem(LOCAL_RECOVERY_CODE_KEY)
    if (pendingRecoveryCode) {
      localStorage.removeItem(LOCAL_RECOVERY_CODE_KEY)
      showRecoveryCode(pendingRecoveryCode, true)
    }
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

async function activateSessionToken(token: string): Promise<void> {
  stopPolling()
  memberToken.value = token
  localStorage.setItem(TOKEN_KEY, token)
  devices.value = []
  actionError.value = ''
  initialized = false
  phase.value = 'loading'
  await initialize()
}

async function createRoom(
  roomName: string,
  nickname: string,
  capacity: RoomCapacity,
  creatorKey: string,
): Promise<void> {
  const result = await cloudDormApi.createRoom({
    roomName,
    nickname,
    deviceLabel: getDeviceLabel(),
    capacity,
    creatorKey,
  })
  saveSession(result.memberToken, result.state)
  if (!initialServerVersion.value) {
    initialServerVersion.value = result.state.serverVersion || ''
  }
  if (result.recoveryCode) showRecoveryCode(result.recoveryCode, true)
}

async function joinRoom(inviteCode: string, nickname: string): Promise<void> {
  const result = await cloudDormApi.joinRoom({
    inviteCode,
    nickname,
    deviceLabel: getDeviceLabel(),
  })
  saveSession(result.memberToken, result.state)
  if (!initialServerVersion.value) {
    initialServerVersion.value = result.state.serverVersion || ''
  }
  if (result.recoveryCode) showRecoveryCode(result.recoveryCode, true)
}

async function linkDevice(code: string): Promise<void> {
  const result = await cloudDormApi.claimDeviceLink({
    code,
    deviceLabel: getDeviceLabel(),
  })
  saveSession(result.memberToken, result.state)
  if (!initialServerVersion.value) {
    initialServerVersion.value = result.state.serverVersion || ''
  }
}

async function recoverAccount(recoveryCode: string): Promise<void> {
  const result = await cloudDormApi.recoverAccount({
    recoveryCode,
    deviceLabel: getDeviceLabel(),
  })
  saveSession(result.memberToken, result.state)
  if (!initialServerVersion.value) {
    initialServerVersion.value = result.state.serverVersion || ''
  }
}

async function saveStatus(update: StatusUpdate): Promise<string | null> {
  const next = await cloudDormApi.updateStatus(memberToken.value, update)
  const warning = next.notificationWarning || null
  applyState(next)
  isOnline.value = true
  return warning
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

async function acknowledgeReleaseNotice(noticeId: string): Promise<void> {
  await cloudDormApi.acknowledgeReleaseNotice(memberToken.value, noticeId)
  releaseNoticeDialog.value = null
}

async function verifyExistingRoom(creatorKey: string): Promise<void> {
  const next = await cloudDormApi.verifyExistingRoom(memberToken.value, creatorKey)
  applyState(next)
}

async function refreshToLatest(): Promise<void> {
  try {
    const registration = await navigator.serviceWorker?.getRegistration()
    await registration?.update()
  } finally {
    window.location.reload()
  }
}

async function getNotificationSettings() {
  const settings = await cloudDormApi.getNotificationSettings(memberToken.value)
  state.room.notificationTopicUpdatedAt = settings.topicUpdatedAt
  state.room.notificationTopicNeedsRotation = settings.topicNeedsRotation
  return settings
}

async function rotateNotificationTopic() {
  const settings = await cloudDormApi.rotateNotificationTopic(memberToken.value)
  state.room.notificationTopicUpdatedAt = settings.topicUpdatedAt
  state.room.notificationTopicNeedsRotation = settings.topicNeedsRotation
  localStorage.setItem(
    NOTIFICATION_TOPIC_SEEN_KEY,
    settings.topicUpdatedAt || new Date().toISOString(),
  )
  notificationTopicUpdateAvailable.value = false
  return settings
}

async function sendTestNotification() {
  return cloudDormApi.sendTestNotification(memberToken.value)
}

async function listBarkDevices() {
  return cloudDormApi.listBarkDevices(memberToken.value)
}

async function registerBarkDevice(deviceKey: string, deviceLabel: string) {
  return cloudDormApi.registerBarkDevice(memberToken.value, {
    deviceKey,
    deviceLabel,
  })
}

async function testBarkNotification(deviceId: string) {
  return cloudDormApi.testBarkNotification(memberToken.value, deviceId)
}

async function removeBarkDevice(deviceId: string) {
  return cloudDormApi.removeBarkDevice(memberToken.value, deviceId)
}

function markNotificationTopicSeen(): void {
  const updatedAt = state.room.notificationTopicUpdatedAt
  if (updatedAt) {
    localStorage.setItem(NOTIFICATION_TOPIC_SEEN_KEY, updatedAt)
  }
  notificationTopicUpdateAvailable.value = false
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
  const releaseNoticeVisible = computed(
    () =>
      Boolean(releaseNoticeDialog.value) &&
      !secretDialog.value &&
      !state.roomVerification?.required,
  )
  const capacityNoticeVisible = computed(
    () =>
      Boolean(capacityNoticeDialog.value) &&
      !secretDialog.value &&
      !releaseNoticeDialog.value &&
      !state.roomVerification?.required,
  )
  const updateAvailable = computed(
    () =>
      Boolean(initialServerVersion.value) &&
      compareVersions(initialServerVersion.value, __APP_VERSION__) > 0,
  )

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
    releaseNoticeDialog,
    releaseNoticeVisible,
    capacityNoticeVisible,
    updateAvailable,
    notificationTopicUpdateAvailable,
    currentMember,
    memberCount,
    availableSeats,
    isOwner,
    initialize,
    retryInitialize,
    activateSessionToken,
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
    acknowledgeReleaseNotice,
    verifyExistingRoom,
    refreshToLatest,
    getNotificationSettings,
    rotateNotificationTopic,
    sendTestNotification,
    listBarkDevices,
    registerBarkDevice,
    testBarkNotification,
    removeBarkDevice,
    markNotificationTopicSeen,
    dismissSecretDialog,
    confirmSecretDialog,
    clearSession,
  }
}
