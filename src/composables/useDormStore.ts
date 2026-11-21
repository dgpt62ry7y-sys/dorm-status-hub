import { computed, reactive, ref } from 'vue'
import { CloudApiError, cloudDormApi } from '../api/cloudDormApi'
import type {
  CapacityNotice,
  DeviceLinkResult,
  DeviceSession,
  DormState,
  DormStatus,
  FeedbackPage,
  ReleaseNotice,
  RoomCapacity,
  StatusUpdate,
} from '../types/dorm'
import {
  createClientId,
  getDeviceInstanceId,
  getDeviceLabel,
} from '../utils/device'
import { saveLastRoomHint } from '../utils/lastRoom'

export type StorePhase = 'loading' | 'onboarding' | 'ready' | 'error'

export interface SecretDialogState {
  title: string
  description: string
  code: string
  required: boolean
}

const TOKEN_KEY = 'dormsync:member-token:v1'
const REFRESH_TOKEN_BACKUP_KEY = 'dormsync:refresh-token:v1'
const NOTIFICATION_TOPIC_SEEN_KEY = 'dormsync:notification-topic-seen:v1'
const LOCAL_RECOVERY_CODE_KEY = 'dormsync:local-test-recovery-code:v1'
const POLL_INTERVAL_MS = 5000
const REALTIME_REFRESH_DEBOUNCE_MS = 180

function restoreRefreshToken(): string {
  const stored = localStorage.getItem(TOKEN_KEY) || ''
  if (stored) return stored
  const backup = sessionStorage.getItem(REFRESH_TOKEN_BACKUP_KEY) || ''
  if (backup) localStorage.setItem(TOKEN_KEY, backup)
  return backup
}

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
const memberToken = ref(restoreRefreshToken())
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
const realtimeConnected = ref(false)
const latestPublicVersion = ref('')
const feedbackEnabled = ref(!__DEMO_MODE__)
const clientUpdateRequired = ref(false)

let pollTimer: number | undefined
let realtimeRefreshTimer: number | undefined
let eventSource: EventSource | null = null
let eventSourceUrl = ''
let realtimeReconnectRefreshPending = false
let refreshInFlight: Promise<void> | null = null
let refreshQueued = false
let queuedClaimCapacityNotice = false
let queuedClaimReleaseNotice = false
let devicesRequestInFlight: Promise<void> | null = null
let lifecycleBound = false
let initialized = false
let lastFocusRetryAt = 0
let pendingJoinRequestKey = ''
let pendingJoinRequestId = ''

function applyState(next: DormState): void {
  const previousRealtime = state.room.realtime
  state.room = next.room
  if (next.room.realtime === undefined) {
    state.room.realtime = previousRealtime
  }
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
  const currentMember = next.members.find(
    (member) => member.id === next.currentMemberId,
  )
  if (next.room.inviteCode) {
    saveLastRoomHint({
      inviteCode: next.room.inviteCode,
      roomName: next.room.name,
      nickname: currentMember?.nickname || '',
    })
  }
  lastSyncedAt.value = new Date().toISOString()
  if (next.capacityNotice) capacityNoticeDialog.value = next.capacityNotice
  if (next.releaseNotice) releaseNoticeDialog.value = next.releaseNotice
  if (phase.value === 'ready') reconcileRealtime()
}

function saveSession(token: string, next: DormState): void {
  memberToken.value = token
  localStorage.setItem(TOKEN_KEY, token)
  sessionStorage.removeItem(REFRESH_TOKEN_BACKUP_KEY)
  applyState(next)
  phase.value = 'ready'
  actionError.value = ''
  startSync()
  window.setTimeout(() => {
    void refresh(true)
  }, 0)
}

function clearSession(): void {
  const storedToken = localStorage.getItem(TOKEN_KEY)
  const failedToken = memberToken.value
  if (storedToken === failedToken) localStorage.removeItem(TOKEN_KEY)
  sessionStorage.removeItem(REFRESH_TOKEN_BACKUP_KEY)
  memberToken.value = ''
  Object.assign(state, createEmptyState())
  phase.value = 'onboarding'
  lastSyncedAt.value = null
  devices.value = []
  secretDialog.value = null
  capacityNoticeDialog.value = null
  releaseNoticeDialog.value = null
  initialServerVersion.value = ''
  notificationTopicUpdateAvailable.value = false
  refreshQueued = false
  queuedClaimCapacityNotice = false
  queuedClaimReleaseNotice = false
  stopSync()
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

async function checkPublicConfig(): Promise<boolean> {
  try {
    if (__DEMO_MODE__) {
      const versionUrl = new URL(
        `${import.meta.env.BASE_URL}version.json`,
        window.location.origin,
      )
      versionUrl.searchParams.set('t', String(Date.now()))
      const response = await fetch(versionUrl, { cache: 'no-store' })
      if (!response.ok) return false
      const config = (await response.json()) as { version?: string }
      const version = String(config.version || '')
      if (version && compareVersions(version, __APP_VERSION__) > 0) {
        window.location.reload()
        return true
      }
      return false
    }

    const config = await cloudDormApi.getPublicConfig()
    latestPublicVersion.value = config.releaseVersion
    feedbackEnabled.value = config.feedbackEnabled
    const required = compareVersions(config.releaseVersion, __APP_VERSION__) > 0
    if (required) {
      clientUpdateRequired.value = true
      stopSync()
    }
    return required
  } catch {
    return false
  }
}

function startFallbackPolling(): void {
  if (pollTimer || phase.value !== 'ready') return
  pollTimer = window.setInterval(() => {
    if (
      document.visibilityState === 'visible' &&
      phase.value === 'ready' &&
      !realtimeConnected.value
    ) {
      void refresh(true)
    }
  }, POLL_INTERVAL_MS)
}

function stopFallbackPolling(): void {
  if (pollTimer) window.clearInterval(pollTimer)
  pollTimer = undefined
}

function closeRealtime(): void {
  if (eventSource) eventSource.close()
  eventSource = null
  eventSourceUrl = ''
  realtimeConnected.value = false
  if (realtimeRefreshTimer) window.clearTimeout(realtimeRefreshTimer)
  realtimeRefreshTimer = undefined
}

function stopSync(): void {
  stopFallbackPolling()
  closeRealtime()
  realtimeReconnectRefreshPending = false
}

function realtimeStreamUrl(): string {
  const realtime = state.room.realtime
  if (!realtime?.serverUrl || !realtime.topic) return ''
  return `${realtime.serverUrl.replace(/\/+$/, '')}/${encodeURIComponent(realtime.topic)}/sse`
}

function scheduleRealtimeRefresh(): void {
  if (realtimeRefreshTimer) window.clearTimeout(realtimeRefreshTimer)
  realtimeRefreshTimer = window.setTimeout(() => {
    realtimeRefreshTimer = undefined
    if (document.visibilityState === 'visible' && phase.value === 'ready') {
      void refresh(true)
    }
  }, REALTIME_REFRESH_DEBOUNCE_MS)
}

function handleRealtimeMessage(event: MessageEvent<string>): void {
  try {
    const payload = JSON.parse(event.data)
    if (payload?.event && payload.event !== 'message') return
  } catch {
    // A malformed event is still a useful refresh signal.
  }
  scheduleRealtimeRefresh()
}

function reconcileRealtime(): void {
  if (__DEMO_MODE__ || phase.value !== 'ready' || !memberToken.value) {
    stopSync()
    return
  }

  const url = realtimeStreamUrl()
  if (
    !url ||
    typeof EventSource === 'undefined' ||
    !navigator.onLine ||
    document.visibilityState !== 'visible'
  ) {
    closeRealtime()
    if (url && typeof EventSource !== 'undefined' && navigator.onLine) {
      startFallbackPolling()
    }
    return
  }

  if (
    eventSource &&
    eventSourceUrl === url &&
    eventSource.readyState !== EventSource.CLOSED
  ) {
    if (!realtimeConnected.value) startFallbackPolling()
    return
  }

  closeRealtime()
  eventSourceUrl = url
  const source = new EventSource(url)
  eventSource = source
  startFallbackPolling()

  source.onopen = () => {
    if (eventSource !== source) return
    realtimeConnected.value = true
    stopFallbackPolling()
    if (realtimeReconnectRefreshPending) {
      realtimeReconnectRefreshPending = false
      scheduleRealtimeRefresh()
    }
  }
  source.onmessage = handleRealtimeMessage
  source.onerror = () => {
    if (eventSource !== source) return
    realtimeConnected.value = false
    realtimeReconnectRefreshPending = true
    startFallbackPolling()
  }
}

function startSync(): void {
  reconcileRealtime()
}

function bindLifecycle(): void {
  if (lifecycleBound) return
  lifecycleBound = true

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      void checkPublicConfig().then((required) => {
        if (required) return
        if (memberToken.value) {
          void refresh(true, true, true)
          reconcileRealtime()
        }
      })
    } else {
      closeRealtime()
    }
  })

  window.addEventListener('online', () => {
    isOnline.value = true
    if (memberToken.value) {
      void refresh(true, true, true)
      reconcileRealtime()
    }
  })
  window.addEventListener('offline', () => {
    isOnline.value = false
    closeRealtime()
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
  if (refreshInFlight) {
    refreshQueued = true
    queuedClaimCapacityNotice ||= claimCapacityNotice
    queuedClaimReleaseNotice ||= claimReleaseNotice
    return refreshInFlight
  }

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
      if (refreshQueued && memberToken.value && phase.value === 'ready') {
        const nextClaimCapacity = queuedClaimCapacityNotice
        const nextClaimRelease = queuedClaimReleaseNotice
        refreshQueued = false
        queuedClaimCapacityNotice = false
        queuedClaimReleaseNotice = false
        window.setTimeout(() => {
          void refresh(true, nextClaimCapacity, nextClaimRelease)
        }, 0)
      }
    }
  })()

  return refreshInFlight
}

async function initialize(): Promise<void> {
  if (initialized) return
  initialized = true
  bindLifecycle()

  if (await checkPublicConfig()) {
    phase.value = 'onboarding'
    return
  }

  if (!memberToken.value) {
    phase.value = 'onboarding'
    return
  }

  try {
    const next = await getInitialState(memberToken.value)
    applyState(next)
    sessionStorage.removeItem(REFRESH_TOKEN_BACKUP_KEY)
    initialServerVersion.value = next.serverVersion || ''
    phase.value = 'ready'
    isOnline.value = true
    startSync()
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
  stopSync()
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
    deviceInstanceId: getDeviceInstanceId(),
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
  const requestKey = `${inviteCode.trim().toUpperCase()}:${nickname.trim()}`
  if (pendingJoinRequestKey !== requestKey || !pendingJoinRequestId) {
    pendingJoinRequestKey = requestKey
    pendingJoinRequestId = createClientId()
  }
  const result = await cloudDormApi.joinRoom({
    inviteCode,
    nickname,
    deviceLabel: getDeviceLabel(),
    deviceInstanceId: getDeviceInstanceId(),
    joinRequestId: pendingJoinRequestId,
  })
  pendingJoinRequestKey = ''
  pendingJoinRequestId = ''
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
    deviceInstanceId: getDeviceInstanceId(),
  })
  saveSession(result.memberToken, result.state)
  if (!initialServerVersion.value) {
    initialServerVersion.value = result.state.serverVersion || ''
  }
}

async function recoverAccount(
  inviteCode: string,
  recoveryCode: string,
): Promise<void> {
  const result = await cloudDormApi.recoverAccount({
    inviteCode,
    recoveryCode,
    deviceLabel: getDeviceLabel(),
    deviceInstanceId: getDeviceInstanceId(),
  })
  saveSession(result.memberToken, result.state)
  if (!initialServerVersion.value) {
    initialServerVersion.value = result.state.serverVersion || ''
  }
}

async function recoverWithAssistance(
  inviteCode: string,
  recoveryMode: 'member' | 'owner' | 'admin',
  recoveryCodes: string[],
): Promise<void> {
  const result = await cloudDormApi.recoverWithAssistance({
    inviteCode,
    recoveryMode,
    recoveryCodes,
    deviceLabel: getDeviceLabel(),
    deviceInstanceId: getDeviceInstanceId(),
  })
  saveSession(result.memberToken, result.state)
  if (!initialServerVersion.value) {
    initialServerVersion.value = result.state.serverVersion || ''
  }
}

async function createMemberRecoveryCode(targetMemberId: string) {
  return cloudDormApi.createMemberRecoveryCode(memberToken.value, targetMemberId)
}

async function createOwnerRecoveryCode() {
  return cloudDormApi.createOwnerRecoveryCode(memberToken.value)
}

async function listRecoveryAudit() {
  return cloudDormApi.listRecoveryAudit(memberToken.value)
}

async function submitFeedback(
  items: string[],
  contact: string,
  page: FeedbackPage,
) {
  return cloudDormApi.submitFeedback({
    items,
    contact,
    page,
    appVersion: __APP_VERSION__,
    deviceLabel: getDeviceLabel(),
    deviceInstanceId: getDeviceInstanceId(),
    memberToken: memberToken.value || undefined,
  })
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
    if (memberToken.value) {
      sessionStorage.setItem(REFRESH_TOKEN_BACKUP_KEY, memberToken.value)
    }
    const url = new URL(window.location.href)
    url.searchParams.set('refresh', String(Date.now()))
    window.location.replace(url.toString())
  }
}

async function getNotificationSettings() {
  const settings = await cloudDormApi.getNotificationSettings(memberToken.value)
  state.room.notificationTopicUpdatedAt = settings.topicUpdatedAt
  state.room.notificationTopicNeedsRotation = settings.topicNeedsRotation
  state.room.realtime = {
    serverUrl: settings.serverUrl,
    topic: settings.topic,
  }
  reconcileRealtime()
  return settings
}

async function rotateNotificationTopic() {
  const settings = await cloudDormApi.rotateNotificationTopic(memberToken.value)
  state.room.notificationTopicUpdatedAt = settings.topicUpdatedAt
  state.room.notificationTopicNeedsRotation = settings.topicNeedsRotation
  state.room.realtime = {
    serverUrl: settings.serverUrl,
    topic: settings.topic,
  }
  reconcileRealtime()
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
      clientUpdateRequired.value ||
      (Boolean(initialServerVersion.value) &&
        compareVersions(initialServerVersion.value, __APP_VERSION__) > 0),
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
    latestPublicVersion,
    feedbackEnabled,
    clientUpdateRequired,
    notificationTopicUpdateAvailable,
    realtimeConnected,
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
    recoverWithAssistance,
    createMemberRecoveryCode,
    createOwnerRecoveryCode,
    listRecoveryAudit,
    submitFeedback,
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
