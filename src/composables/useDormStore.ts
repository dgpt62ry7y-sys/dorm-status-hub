import { computed, reactive, ref } from 'vue'
import { CloudApiError, cloudDormApi } from '../api/cloudDormApi'
import type { DormState, DormStatus, StatusUpdate } from '../types/dorm'

export type StorePhase = 'loading' | 'onboarding' | 'ready' | 'error'

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

let pollTimer: number | undefined
let refreshInFlight: Promise<void> | null = null
let lifecycleBound = false
let initialized = false

function applyState(next: DormState): void {
  state.room = next.room
  state.currentMemberId = next.currentMemberId
  state.members = next.members
  state.statuses = next.statuses
  state.preferences = next.preferences
  lastSyncedAt.value = new Date().toISOString()
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
  stopPolling()
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
      void refresh(true)
    }
  })

  window.addEventListener('online', () => {
    isOnline.value = true
    if (memberToken.value) void refresh(true)
  })
  window.addEventListener('offline', () => {
    isOnline.value = false
  })
}

async function refresh(silent = true): Promise<void> {
  if (!memberToken.value || phase.value !== 'ready') return
  if (refreshInFlight) return refreshInFlight

  isSyncing.value = true
  refreshInFlight = (async () => {
    try {
      const next = await cloudDormApi.getState(memberToken.value)
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
    const next = await cloudDormApi.getState(memberToken.value)
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

async function createRoom(roomName: string, nickname: string): Promise<void> {
  const result = await cloudDormApi.createRoom({ roomName, nickname })
  saveSession(result.memberToken, result.state)
}

async function joinRoom(inviteCode: string, nickname: string): Promise<void> {
  const result = await cloudDormApi.joinRoom({ inviteCode, nickname })
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
    currentMember,
    memberCount,
    availableSeats,
    isOwner,
    initialize,
    retryInitialize,
    refresh,
    createRoom,
    joinRoom,
    saveStatus,
    saveProfile,
    updateNickname,
    updateDefaultStatus,
    regenerateInvite,
    removeMember,
    leaveRoom,
    clearSession,
  }
}
