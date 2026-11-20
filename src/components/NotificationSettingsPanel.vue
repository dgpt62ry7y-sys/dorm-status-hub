<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  BellRing,
  Check,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
  RefreshCw,
  ShieldAlert,
  Smartphone,
  TestTube2,
} from '@lucide/vue'
import { useDormStore } from '../composables/useDormStore'
import type { NotificationSettings } from '../types/dorm'

const emit = defineEmits<{
  notify: [message: string]
}>()

const {
  isOwner,
  getNotificationSettings,
  rotateNotificationTopic,
  sendTestNotification,
  markNotificationTopicSeen,
} = useDormStore()

const settings = ref<NotificationSettings | null>(null)
const loading = ref(false)
const rotating = ref(false)
const testing = ref(false)
const errorMessage = ref('')
const topicVisible = ref(false)
const copied = ref(false)
let copyTimer: number | undefined

const userAgent = navigator.userAgent
const isAndroid = /Android/i.test(userAgent)
const isIOS = /iPhone|iPad|iPod/i.test(userAgent)
const isWeChat = /MicroMessenger/i.test(userAgent)

const displayTopic = computed(() => {
  const topic = settings.value?.topic || ''
  if (!topic) return ''
  if (topicVisible.value) return topic
  return `${topic.slice(0, 12)}${'•'.repeat(16)}${topic.slice(-4)}`
})

const needsAttention = computed(
  () => Boolean(settings.value?.isOwner && settings.value?.topicNeedsRotation),
)

async function loadSettings(): Promise<void> {
  loading.value = true
  errorMessage.value = ''
  try {
    settings.value = await getNotificationSettings()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '通知设置读取失败'
  } finally {
    loading.value = false
  }
}

async function copyTopic(): Promise<void> {
  const topic = settings.value?.topic
  if (!topic) return
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(topic)
    else throw new Error('Clipboard API unavailable')
  } catch {
    const textarea = document.createElement('textarea')
    textarea.value = topic
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    textarea.remove()
  }
  copied.value = true
  markNotificationTopicSeen()
  if (copyTimer) window.clearTimeout(copyTimer)
  copyTimer = window.setTimeout(() => {
    copied.value = false
  }, 1_800)
}

function markSubscribed(): void {
  markNotificationTopicSeen()
  emit('notify', '已隐藏本设备的订阅提醒')
}

function openAndroidSubscription(): void {
  markNotificationTopicSeen()
  window.location.href = settings.value?.androidDeepLink || ''
}

async function rotateTopic(): Promise<void> {
  if (
    !window.confirm(
      '重新生成后，所有成员都必须在每台设备上重新订阅。旧 Topic 不会被 ntfy.sh 删除，确认继续吗？',
    )
  ) {
    return
  }

  rotating.value = true
  errorMessage.value = ''
  try {
    settings.value = await rotateNotificationTopic()
    topicVisible.value = true
    emit('notify', '通知频道已更新，请让所有成员重新订阅')
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '通知频道更新失败'
  } finally {
    rotating.value = false
  }
}

async function sendTest(): Promise<void> {
  testing.value = true
  try {
    await sendTestNotification()
    emit('notify', '测试通知已发送')
  } catch (error) {
    emit('notify', error instanceof Error ? error.message : '测试通知发送失败')
  } finally {
    testing.value = false
  }
}

onMounted(() => {
  void loadSettings()
})

onBeforeUnmount(() => {
  if (copyTimer) window.clearTimeout(copyTimer)
})
</script>

<template>
  <section
    class="settings-section notification-panel"
    aria-labelledby="notification-heading"
  >
    <div class="settings-section__heading">
      <div>
        <p class="eyebrow">宿舍通知</p>
        <h2 id="notification-heading">ntfy 共享频道</h2>
      </div>
      <span class="notification-panel__badge">
        <BellRing :size="15" aria-hidden="true" />
        Priority 4
      </span>
    </div>

    <p class="notification-panel__intro">
      开启后，室友主动修改状态时，可以在 ntfy App 收到宿舍通知。通知通过公共
      ntfy.sh 转发，可能略有延迟。
    </p>

    <div v-if="needsAttention" class="notification-alert">
      <ShieldAlert :size="18" aria-hidden="true" />
      <div>
        <strong>通知频道需要重新订阅</strong>
        <p>
          房主已更新频道，或近期有成员退出。请在每台设备取消旧订阅并订阅当前 Topic。
        </p>
      </div>
    </div>

    <div v-if="loading" class="notification-loading">
      <LoaderCircle class="spin" :size="18" aria-hidden="true" />
      正在读取通知频道
    </div>

    <p v-else-if="errorMessage" class="form-error">{{ errorMessage }}</p>

    <template v-else-if="settings">
      <dl class="notification-facts">
        <div>
          <dt>服务器</dt>
          <dd>{{ settings.serverUrl }}</dd>
        </div>
        <div>
          <dt>频道</dt>
          <dd class="notification-topic">
            <code>{{ displayTopic }}</code>
            <button
              type="button"
              :aria-label="topicVisible ? '隐藏 Topic' : '显示 Topic'"
              @click="topicVisible = !topicVisible"
            >
              <EyeOff v-if="topicVisible" :size="16" aria-hidden="true" />
              <Eye v-else :size="16" aria-hidden="true" />
            </button>
          </dd>
        </div>
      </dl>

      <div class="notification-actions">
        <button type="button" class="button button--secondary" @click="copyTopic">
          <Check v-if="copied" :size="16" aria-hidden="true" />
          <Copy v-else :size="16" aria-hidden="true" />
          {{ copied ? '已复制' : '复制频道' }}
        </button>
        <a
          class="button button--secondary"
          :href="settings.installUrl"
          target="_blank"
          rel="noopener noreferrer"
        >
          <Smartphone :size="16" aria-hidden="true" />
          安装 ntfy
        </a>
        <button
          v-if="isAndroid"
          type="button"
          class="button button--primary"
          @click="openAndroidSubscription"
        >
          <ExternalLink :size="16" aria-hidden="true" />
          打开并订阅
        </button>
      </div>

      <div class="notification-steps">
        <template v-if="isAndroid">
          <strong>Android 订阅步骤</strong>
          <p v-if="isWeChat">
            微信内置浏览器可能拦截 ntfy 深链。若“打开并订阅”没有反应，请复制 Topic
            后在 ntfy App 中手动添加。
          </p>
          <p v-else>
            点击“打开并订阅”；若未自动完成，请复制 Topic 后在 ntfy App 手动添加。
          </p>
        </template>
        <template v-else-if="isIOS">
          <strong>iPhone 订阅步骤</strong>
          <ol>
            <li>安装并打开 ntfy App。</li>
            <li>点击添加订阅。</li>
            <li>粘贴上面复制的 Topic。</li>
            <li>确认订阅服务器为当前显示的服务器。</li>
          </ol>
        </template>
        <template v-else>
          <strong>电脑或其他设备</strong>
          <p>复制 Topic 后，在 ntfy App 或 Web 端添加同一服务器和 Topic。</p>
        </template>
      </div>

      <button type="button" class="text-button notification-seen" @click="markSubscribed">
        <Check :size="15" aria-hidden="true" />
        我已在此设备添加订阅
      </button>

      <div v-if="isOwner" class="notification-owner-actions">
        <button type="button" class="button button--secondary" :disabled="testing" @click="sendTest">
          <LoaderCircle v-if="testing" class="spin" :size="16" aria-hidden="true" />
          <TestTube2 v-else :size="16" aria-hidden="true" />
          {{ testing ? '正在发送…' : '发送测试通知' }}
        </button>
        <button type="button" class="button button--ghost" :disabled="rotating" @click="rotateTopic">
          <LoaderCircle v-if="rotating" class="spin" :size="16" aria-hidden="true" />
          <RefreshCw v-else :size="16" aria-hidden="true" />
          {{ rotating ? '正在更新…' : '重新生成通知频道' }}
        </button>
      </div>
    </template>

    <div class="notification-security">
      <KeyRound :size="18" aria-hidden="true" />
      <p>
        Topic 相当于共享密码。知道 Topic 的人可以订阅、读取或伪造消息。请勿发送到公开群聊、仓库或截图。
      </p>
    </div>
  </section>
</template>
