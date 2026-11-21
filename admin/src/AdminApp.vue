<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  Check,
  CheckCheck,
  Copy,
  DoorOpen,
  Inbox,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  BellRing,
  MessageSquareText,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  X,
} from '@lucide/vue'

interface AdminRoom {
  id: string
  name: string
  ownerNickname: string
  memberCount: number
  capacity: number
  createdAt: string | null
  lastActiveAt: string | null
  verificationStatus: 'verified' | 'pending'
  verificationPromptedAt: string | null
  verificationDeadlineAt: string | null
  verificationFallbackAt: string | null
  closed: boolean
}

interface AdminRescueResult {
  code: string
  expiresAt: string
  roomName: string
  ownerNickname: string
  inviteCode: string
}

interface AdminFeedback {
  id: string
  items: string[]
  contact: string
  page: 'creation' | 'settings'
  appVersion: string
  deviceLabel: string
  roomName: string
  inviteCode: string
  status: 'unread' | 'read'
  createdAt: string
}

const apiUrl = import.meta.env.VITE_DORMSYNC_API_URL
const storedKey = sessionStorage.getItem('dormsync:admin-key') || ''
const adminKey = ref(storedKey)
const rooms = ref<AdminRoom[]>([])
const loading = ref(false)
const errorMessage = ref('')
const query = ref('')
const rescueRoom = ref<AdminRoom | null>(null)
const rescueCreatorKey = ref('')
const rescueLoading = ref(false)
const rescueError = ref('')
const rescueResult = ref<AdminRescueResult | null>(null)
const rescueCopied = ref(false)
const activeView = ref<'rooms' | 'feedback'>('rooms')
const feedbackEntries = ref<AdminFeedback[]>([])
const feedbackLoading = ref(false)
const feedbackError = ref('')
const feedbackBarkInput = ref('')
const feedbackBarkConfigured = ref(false)
const feedbackBarkMasked = ref('')
const feedbackBarkSaving = ref(false)
const feedbackBarkError = ref('')
const feedbackBarkNotice = ref('')
const copiedFeedbackId = ref('')

const filteredRooms = computed(() => {
  const keyword = query.value.trim().toLowerCase()
  if (!keyword) return rooms.value
  return rooms.value.filter(
    (room) =>
      room.name.toLowerCase().includes(keyword) ||
      room.ownerNickname.toLowerCase().includes(keyword) ||
      room.id.toLowerCase().includes(keyword),
  )
})

const pendingCount = computed(
  () => rooms.value.filter((room) => room.verificationStatus === 'pending').length,
)

const unreadFeedbackCount = computed(
  () => feedbackEntries.value.filter((item) => item.status === 'unread').length,
)

function formatTime(value: string | null): string {
  if (!value) return '暂无'
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return '暂无'
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatRecoveryCode(value: string): string {
  return value.match(/.{1,4}/g)?.join('-') || value
}

async function adminRequest(
  action: string,
  payload: Record<string, unknown> = {},
): Promise<Record<string, any>> {
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, adminKey: adminKey.value, ...payload }),
  })
  const result = await response.json()
  if (!result.ok) throw new Error(result.error.message)
  return result.data
}

async function loadRooms(): Promise<void> {
  if (!adminKey.value.trim()) {
    errorMessage.value = '请输入管理密钥'
    return
  }

  loading.value = true
  errorMessage.value = ''
  try {
    const data = await adminRequest('adminListRooms')
    rooms.value = data.rooms
    sessionStorage.setItem('dormsync:admin-key', adminKey.value)
    await Promise.all([loadFeedback(), loadFeedbackBark()])
  } catch (error) {
    rooms.value = []
    errorMessage.value = error instanceof Error ? error.message : '读取失败'
  } finally {
    loading.value = false
  }
}

async function loadFeedback(): Promise<void> {
  if (!adminKey.value.trim()) return
  feedbackLoading.value = true
  feedbackError.value = ''
  try {
    const data = await adminRequest('adminListFeedback')
    feedbackEntries.value = data.entries
  } catch (error) {
    feedbackError.value = error instanceof Error ? error.message : '反馈读取失败'
  } finally {
    feedbackLoading.value = false
  }
}

async function loadFeedbackBark(): Promise<void> {
  try {
    const data = await adminRequest('adminGetFeedbackBark')
    feedbackBarkConfigured.value = Boolean(data.configured)
    feedbackBarkMasked.value = data.maskedKey || ''
  } catch {
    feedbackBarkConfigured.value = false
    feedbackBarkMasked.value = ''
  }
}

async function setFeedbackStatus(
  feedback: AdminFeedback,
  status: 'read' | 'unread',
): Promise<void> {
  try {
    await adminRequest('adminUpdateFeedback', {
      feedbackId: feedback.id,
      feedbackAction: status,
    })
    feedback.status = status
  } catch (error) {
    feedbackError.value = error instanceof Error ? error.message : '反馈更新失败'
  }
}

async function deleteFeedback(feedback: AdminFeedback): Promise<void> {
  if (!window.confirm('永久删除这条反馈？')) return
  try {
    await adminRequest('adminUpdateFeedback', {
      feedbackId: feedback.id,
      feedbackAction: 'delete',
    })
    feedbackEntries.value = feedbackEntries.value.filter(
      (item) => item.id !== feedback.id,
    )
  } catch (error) {
    feedbackError.value = error instanceof Error ? error.message : '反馈删除失败'
  }
}

async function copyFeedbackContact(feedback: AdminFeedback): Promise<void> {
  if (!feedback.contact) return
  try {
    await navigator.clipboard.writeText(feedback.contact)
  } catch {
    const textarea = document.createElement('textarea')
    textarea.value = feedback.contact
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    textarea.remove()
  }
  copiedFeedbackId.value = feedback.id
  window.setTimeout(() => {
    copiedFeedbackId.value = ''
  }, 1400)
}

async function saveFeedbackBark(): Promise<void> {
  if (!feedbackBarkInput.value.trim()) {
    feedbackBarkError.value = '请输入 Bark Device Key 或测试链接'
    return
  }
  feedbackBarkSaving.value = true
  feedbackBarkError.value = ''
  feedbackBarkNotice.value = ''
  try {
    const data = await adminRequest('adminSaveFeedbackBark', {
      deviceKey: feedbackBarkInput.value.trim(),
    })
    feedbackBarkConfigured.value = true
    feedbackBarkMasked.value = data.maskedKey || ''
    feedbackBarkInput.value = ''
    feedbackBarkNotice.value = '测试通知发送成功，反馈通知地址已加密保存'
  } catch (error) {
    feedbackBarkError.value =
      error instanceof Error ? error.message : 'Bark 地址保存失败'
  } finally {
    feedbackBarkSaving.value = false
  }
}

function logout(): void {
  sessionStorage.removeItem('dormsync:admin-key')
  adminKey.value = ''
  rooms.value = []
  errorMessage.value = ''
  closeRescue()
  feedbackEntries.value = []
  feedbackBarkInput.value = ''
  feedbackBarkConfigured.value = false
  feedbackBarkMasked.value = ''
  activeView.value = 'rooms'
}

function openRescue(room: AdminRoom): void {
  if (room.closed || !room.ownerNickname) return
  rescueRoom.value = room
  rescueCreatorKey.value = ''
  rescueError.value = ''
  rescueResult.value = null
  rescueCopied.value = false
}

function closeRescue(): void {
  if (rescueLoading.value) return
  rescueRoom.value = null
  rescueCreatorKey.value = ''
  rescueError.value = ''
  rescueResult.value = null
  rescueCopied.value = false
}

async function createRescueCode(): Promise<void> {
  const room = rescueRoom.value
  if (!room) return
  if (!rescueCreatorKey.value.trim()) {
    rescueError.value = '请输入寝室创建密钥'
    return
  }

  rescueLoading.value = true
  rescueError.value = ''
  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'adminCreateOwnerRecoveryCode',
        adminKey: adminKey.value,
        creatorKey: rescueCreatorKey.value,
        roomId: room.id,
      }),
    })
    const result = await response.json()
    if (!result.ok) throw new Error(result.error.message)
    rescueResult.value = {
      code: result.data.code,
      expiresAt: result.data.expiresAt,
      roomName: result.data.roomName,
      ownerNickname: result.data.ownerNickname,
      inviteCode: result.data.inviteCode,
    }
    rescueCreatorKey.value = ''
  } catch (error) {
    rescueError.value = error instanceof Error ? error.message : '救援码生成失败'
  } finally {
    rescueLoading.value = false
  }
}

async function copyRescueCode(): Promise<void> {
  const code = rescueResult.value?.code
  if (!code) return
  try {
    if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable')
    await navigator.clipboard.writeText(formatRecoveryCode(code))
  } catch {
    const textarea = document.createElement('textarea')
    textarea.value = formatRecoveryCode(code)
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    textarea.remove()
  }
  rescueCopied.value = true
  window.setTimeout(() => {
    rescueCopied.value = false
  }, 1600)
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && rescueRoom.value) closeRescue()
}

onMounted(() => {
  if (storedKey) void loadRooms()
  document.addEventListener('keydown', handleKeydown)
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <main class="admin-shell">
    <header class="admin-header">
      <div>
        <p class="admin-eyebrow">LOCAL ADMIN / CONTROLLED ACCESS</p>
        <h1>寝室管理台</h1>
        <p>仅在本机运行，读取寝室摘要，并可为房主生成一次性账号救援码。</p>
      </div>
      <span class="admin-secure">
        <ShieldCheck :size="17" aria-hidden="true" />
        本地安全操作
      </span>
    </header>

    <section class="admin-gate">
      <label>
        <span>管理密钥</span>
        <input
          v-model="adminKey"
          type="password"
          autocomplete="off"
          placeholder="仅保存在当前标签页"
          @keyup.enter="loadRooms"
        />
      </label>
      <button type="button" :disabled="loading" @click="loadRooms">
        <LoaderCircle v-if="loading" class="spin" :size="17" aria-hidden="true" />
        <LockKeyhole v-else :size="17" aria-hidden="true" />
        {{ loading ? '正在读取…' : '进入管理台' }}
      </button>
      <button v-if="rooms.length" type="button" class="admin-logout" @click="logout">
        锁定并清除
      </button>
    </section>

    <p v-if="errorMessage" class="admin-error">{{ errorMessage }}</p>

    <template v-if="rooms.length || feedbackEntries.length">
      <nav class="admin-tabs" aria-label="管理台视图">
        <button
          type="button"
          :class="{ active: activeView === 'rooms' }"
          @click="activeView = 'rooms'"
        >
          寝室列表
          <span>{{ rooms.length }}</span>
        </button>
        <button
          type="button"
          :class="{ active: activeView === 'feedback' }"
          @click="activeView = 'feedback'; loadFeedback()"
        >
          反馈收件箱
          <span v-if="unreadFeedbackCount">{{ unreadFeedbackCount }}</span>
        </button>
      </nav>

      <template v-if="activeView === 'rooms'">
        <section class="admin-summary">
        <div>
          <span>寝室总数</span>
          <strong>{{ rooms.length }}</strong>
        </div>
        <div>
          <span>待验证</span>
          <strong>{{ pendingCount }}</strong>
        </div>
        <div>
          <span>当前筛选</span>
          <strong>{{ filteredRooms.length }}</strong>
        </div>
        <button type="button" :disabled="loading" @click="loadRooms">
          <RefreshCw :class="{ spin: loading }" :size="16" aria-hidden="true" />
          刷新
        </button>
      </section>

      <label class="admin-search">
        <Search :size="16" aria-hidden="true" />
        <input v-model="query" type="search" placeholder="查找寝室名称、房主或 ID" />
      </label>

      <div class="admin-table-wrap">
        <table>
          <thead>
            <tr>
              <th>寝室</th>
              <th>房主</th>
              <th>成员</th>
              <th>房型</th>
              <th>验证</th>
              <th>最近活动</th>
              <th>创建时间</th>
              <th>账号救援</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="room in filteredRooms" :key="room.id">
              <td>
                <strong>{{ room.name }}</strong>
                <small>{{ room.id }}</small>
              </td>
              <td>{{ room.ownerNickname || '暂无' }}</td>
              <td>{{ room.memberCount }}</td>
              <td>{{ room.capacity }} 人寝</td>
              <td>
                <span
                  class="admin-status"
                  :class="{
                    'admin-status--verified': room.verificationStatus === 'verified',
                    'admin-status--pending': room.verificationStatus === 'pending',
                  }"
                >
                  {{ room.closed ? '已关闭' : room.verificationStatus === 'verified' ? '已验证' : '待验证' }}
                </span>
                <small v-if="room.verificationStatus === 'pending'">
                  截止 {{ formatTime(room.verificationDeadlineAt) }}
                </small>
              </td>
              <td>{{ formatTime(room.lastActiveAt) }}</td>
              <td>{{ formatTime(room.createdAt) }}</td>
              <td>
                <button
                  type="button"
                  class="admin-rescue-button"
                  :disabled="room.closed || !room.ownerNickname"
                  @click="openRescue(room)"
                >
                  <KeyRound :size="14" aria-hidden="true" />
                  生成救援码
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

        <p v-if="filteredRooms.length === 0" class="admin-empty">
          <DoorOpen :size="18" aria-hidden="true" />
          没有匹配的寝室
        </p>
      </template>

      <section v-else class="admin-feedback">
        <header class="admin-feedback__header">
          <div>
            <p class="admin-eyebrow">FEEDBACK INBOX</p>
            <h2>反馈收件箱</h2>
            <p>反馈永久保留，只在当前本机管理台可见。</p>
          </div>
          <button type="button" :disabled="feedbackLoading" @click="loadFeedback">
            <RefreshCw :class="{ spin: feedbackLoading }" :size="16" aria-hidden="true" />
            刷新反馈
          </button>
        </header>

        <section class="admin-bark-setting">
          <div class="admin-bark-setting__copy">
            <span><BellRing :size="17" aria-hidden="true" /> 独享 Bark 通知</span>
            <strong v-if="feedbackBarkConfigured">
              已连接 {{ feedbackBarkMasked }}
            </strong>
            <strong v-else>尚未连接</strong>
            <p>每条新反馈立即推送；联系方式不会进入 Bark 通知。</p>
          </div>
          <div class="admin-bark-setting__form">
            <input
              v-model="feedbackBarkInput"
              type="password"
              autocomplete="off"
              placeholder="粘贴 Bark Device Key 或 api.day.app 测试链接"
              @keyup.enter="saveFeedbackBark"
            />
            <button type="button" :disabled="feedbackBarkSaving" @click="saveFeedbackBark">
              <LoaderCircle
                v-if="feedbackBarkSaving"
                class="spin"
                :size="15"
                aria-hidden="true"
              />
              <BellRing v-else :size="15" aria-hidden="true" />
              {{ feedbackBarkSaving ? '正在测试…' : '测试并保存' }}
            </button>
          </div>
          <p v-if="feedbackBarkError" class="admin-feedback__error">
            {{ feedbackBarkError }}
          </p>
          <p v-if="feedbackBarkNotice" class="admin-feedback__notice">
            {{ feedbackBarkNotice }}
          </p>
        </section>

        <p v-if="feedbackError" class="admin-feedback__error">{{ feedbackError }}</p>
        <div v-if="feedbackLoading" class="admin-feedback__loading">
          <LoaderCircle class="spin" :size="17" aria-hidden="true" />
          正在读取反馈
        </div>
        <p v-else-if="feedbackEntries.length === 0" class="admin-empty">
          <Inbox :size="18" aria-hidden="true" />
          暂无反馈
        </p>
        <div v-else class="admin-feedback__list">
          <article
            v-for="feedback in feedbackEntries"
            :key="feedback.id"
            :class="{ unread: feedback.status === 'unread' }"
          >
            <header>
              <span>
                <MessageSquareText :size="15" aria-hidden="true" />
                {{ feedback.page === 'settings' ? '设置页反馈' : '创建页反馈' }}
                <i v-if="feedback.status === 'unread'">未读</i>
              </span>
              <time>{{ formatTime(feedback.createdAt) }}</time>
            </header>
            <ol>
              <li v-for="(item, index) in feedback.items" :key="index">{{ item }}</li>
            </ol>
            <div class="admin-feedback__meta">
              <span v-if="feedback.roomName">
                {{ feedback.roomName }}
                <small v-if="feedback.inviteCode">{{ feedback.inviteCode }}</small>
              </span>
              <span>{{ feedback.deviceLabel || '设备未知' }}</span>
              <span>V{{ feedback.appVersion || '未知' }}</span>
            </div>
            <div class="admin-feedback__contact">
              <span>联系方式</span>
              <strong>{{ feedback.contact || '未填写' }}</strong>
              <button
                v-if="feedback.contact"
                type="button"
                @click="copyFeedbackContact(feedback)"
              >
                <Check v-if="copiedFeedbackId === feedback.id" :size="14" aria-hidden="true" />
                <Copy v-else :size="14" aria-hidden="true" />
                {{ copiedFeedbackId === feedback.id ? '已复制' : '复制' }}
              </button>
            </div>
            <div class="admin-feedback__actions">
              <button
                type="button"
                @click="setFeedbackStatus(feedback, feedback.status === 'unread' ? 'read' : 'unread')"
              >
                <CheckCheck :size="14" aria-hidden="true" />
                {{ feedback.status === 'unread' ? '标为已读' : '标为未读' }}
              </button>
              <button type="button" class="danger" @click="deleteFeedback(feedback)">
                <Trash2 :size="14" aria-hidden="true" />
                删除
              </button>
            </div>
          </article>
        </div>
      </section>
    </template>

    <Teleport to="body">
      <Transition name="admin-dialog">
        <div
          v-if="rescueRoom"
          class="admin-dialog-layer"
          role="presentation"
          @click.self="closeRescue"
        >
          <section
            class="admin-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="admin-rescue-title"
          >
            <button
              type="button"
              class="admin-dialog-close"
              aria-label="关闭"
              :disabled="rescueLoading"
              @click="closeRescue"
            >
              <X :size="18" aria-hidden="true" />
            </button>

            <div class="admin-dialog-heading">
              <span class="admin-dialog-icon">
                <KeyRound :size="21" aria-hidden="true" />
              </span>
              <div>
                <p>ACCOUNT RESCUE</p>
                <h2 id="admin-rescue-title">
                  {{ rescueResult ? '房主救援码已生成' : `救援「${rescueRoom.name}」房主` }}
                </h2>
              </div>
            </div>

            <template v-if="!rescueResult">
              <p class="admin-dialog-copy">
                该操作不会显示或导出长期恢复码，只会生成一个新的 10 分钟一次性救援码。
                需要同时验证当前管理密钥和寝室创建密钥。
              </p>

              <div class="admin-rescue-target">
                <span>房主</span>
                <strong>{{ rescueRoom.ownerNickname }}</strong>
                <small>{{ rescueRoom.name }} · {{ rescueRoom.memberCount }} 名成员</small>
              </div>

              <label class="admin-dialog-field">
                <span>寝室创建密钥</span>
                <input
                  v-model="rescueCreatorKey"
                  type="password"
                  autocomplete="off"
                  placeholder="仅用于本次验证，不保存"
                  @keyup.enter="createRescueCode"
                />
              </label>

              <div class="admin-dialog-warning">
                <ShieldAlert :size="17" aria-hidden="true" />
                <span>救援码只能恢复房主账号，不能恢复普通成员；提交后请立即使用。</span>
              </div>

              <p v-if="rescueError" class="admin-dialog-error">{{ rescueError }}</p>

              <div class="admin-dialog-actions">
                <button type="button" class="admin-dialog-cancel" @click="closeRescue">
                  取消
                </button>
                <button
                  type="button"
                  class="admin-dialog-confirm"
                  :disabled="rescueLoading"
                  @click="createRescueCode"
                >
                  <LoaderCircle
                    v-if="rescueLoading"
                    class="spin"
                    :size="16"
                    aria-hidden="true"
                  />
                  <KeyRound v-else :size="16" aria-hidden="true" />
                  {{ rescueLoading ? '正在验证并生成…' : '生成一次性救援码' }}
                </button>
              </div>
            </template>

            <template v-else>
              <p class="admin-dialog-copy">
                已为「{{ rescueResult.roomName }}」房主
                {{ rescueResult.ownerNickname }} 生成救援码。请回到网站恢复账号页面使用。
              </p>

              <div class="admin-rescue-code">
                <code>{{ formatRecoveryCode(rescueResult.code) }}</code>
                <button type="button" @click="copyRescueCode">
                  <Check v-if="rescueCopied" :size="16" aria-hidden="true" />
                  <Copy v-else :size="16" aria-hidden="true" />
                  {{ rescueCopied ? '已复制' : '复制' }}
                </button>
              </div>

              <div class="admin-rescue-share">
                <span>宿舍分享号</span>
                <strong>{{ rescueResult.inviteCode }}</strong>
                <small>恢复时同时输入这个分享号和上面的救援码。</small>
              </div>

              <div class="admin-rescue-expiry">
                <span>有效期至</span>
                <strong>{{ formatTime(rescueResult.expiresAt) }}</strong>
                <small>只能使用一次，关闭页面后不会再次显示。</small>
              </div>

              <button type="button" class="admin-dialog-confirm admin-dialog-finish" @click="closeRescue">
                我已保存，关闭
              </button>
            </template>
          </section>
        </div>
      </Transition>
    </Teleport>
  </main>
</template>
