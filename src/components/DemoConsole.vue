<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  FlaskConical,
  Inbox,
  LoaderCircle,
  RotateCcw,
  Share2,
  Users,
  X,
} from '@lucide/vue'
import { useDormStore } from '../composables/useDormStore'
import {
  DEMO_NOTIFICATION_EVENT,
  clearDemoNotifications,
  getDemoAccounts,
  getDemoNotifications,
  resetDemo,
  type DemoAccount,
  type DemoNotification,
} from '../demo/demoRuntime'
import { getDemoExperienceUrl } from '../utils/share'

const { state, activateSessionToken } = useDormStore()
const router = useRouter()
const open = ref(false)
const accounts = ref<DemoAccount[]>(getDemoAccounts())
const notifications = ref<DemoNotification[]>(getDemoNotifications())
const switchingId = ref('')
const resetting = ref(false)
const copied = ref(false)
let copyTimer: number | undefined

const currentAccount = computed(() =>
  accounts.value.find((account) => account.memberId === state.currentMemberId),
)

function refreshDemoData(): void {
  accounts.value = getDemoAccounts()
  notifications.value = getDemoNotifications()
}

async function switchAccount(account: DemoAccount): Promise<void> {
  if (account.memberId === state.currentMemberId || switchingId.value) return
  switchingId.value = account.memberId
  try {
    await activateSessionToken(account.memberToken)
    await router.push('/')
    open.value = false
  } finally {
    switchingId.value = ''
  }
}

async function resetExperience(): Promise<void> {
  if (!window.confirm('恢复初始六人寝、六个账号和模拟通知？')) return
  resetting.value = true
  try {
    const next = resetDemo()
    refreshDemoData()
    await activateSessionToken(next.token)
    await router.push('/')
    open.value = false
  } finally {
    resetting.value = false
  }
}

async function copyDemoLink(): Promise<void> {
  const url = getDemoExperienceUrl()
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(url)
  } else {
    const textarea = document.createElement('textarea')
    textarea.value = url
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    textarea.remove()
  }
  copied.value = true
  if (copyTimer) window.clearTimeout(copyTimer)
  copyTimer = window.setTimeout(() => {
    copied.value = false
  }, 1_800)
}

function handleNotification(): void {
  refreshDemoData()
}

watch(
  () => state.members.map((member) => member.id).join(','),
  () => refreshDemoData(),
)

onMounted(() => {
  window.addEventListener(DEMO_NOTIFICATION_EVENT, handleNotification)
})

onBeforeUnmount(() => {
  window.removeEventListener(DEMO_NOTIFICATION_EVENT, handleNotification)
  if (copyTimer) window.clearTimeout(copyTimer)
})
</script>

<template>
  <div class="demo-console">
    <button v-if="!open" type="button" class="demo-console__trigger" @click="open = true">
      <FlaskConical :size="16" aria-hidden="true" />
      体验控制
      <i v-if="notifications.length">{{ notifications.length }}</i>
    </button>

    <section v-else class="demo-console__panel" aria-label="体验版控制台">
      <header>
        <span>
          <FlaskConical :size="17" aria-hidden="true" />
          体验版控制台
        </span>
        <button type="button" aria-label="关闭体验控制台" @click="open = false">
          <X :size="16" aria-hidden="true" />
        </button>
      </header>

      <div class="demo-console__summary">
        <span>当前身份</span>
        <strong>{{ currentAccount?.nickname || '体验成员' }}</strong>
        <small>虚拟数据，不连接正式服务</small>
      </div>

      <section class="demo-console__accounts">
        <div>
          <Users :size="14" aria-hidden="true" />
          切换六个测试账号
        </div>
        <button
          v-for="account in accounts"
          :key="account.memberId"
          type="button"
          :class="{ active: account.memberId === state.currentMemberId }"
          :disabled="Boolean(switchingId)"
          @click="switchAccount(account)"
        >
          <span>{{ Array.from(account.nickname)[0] }}</span>
          {{ account.nickname }}
          <LoaderCircle
            v-if="switchingId === account.memberId"
            class="spin"
            :size="13"
            aria-hidden="true"
          />
          <i v-else-if="account.memberId === state.currentMemberId">当前</i>
        </button>
      </section>

      <section class="demo-console__notifications">
        <div>
          <Inbox :size="14" aria-hidden="true" />
          模拟通知
          <i>{{ notifications.length }}</i>
        </div>
        <p v-if="notifications.length === 0">修改任一成员状态后，这里会出现模拟通知。</p>
        <div v-else class="demo-console__notification-list">
          <article v-for="notification in notifications.slice(0, 5)" :key="notification.id">
            <strong>{{ notification.title }}</strong>
            <pre>{{ notification.body }}</pre>
            <span>
              <i v-for="channel in notification.channels" :key="channel">{{ channel }}</i>
            </span>
          </article>
        </div>
        <button
          v-if="notifications.length"
          type="button"
          class="demo-console__clear"
          @click="clearDemoNotifications(); refreshDemoData()"
        >
          清空通知记录
        </button>
      </section>

      <div class="demo-console__actions">
        <button type="button" @click="copyDemoLink">
          <Share2 :size="14" aria-hidden="true" />
          {{ copied ? '链接已复制' : '复制体验链接' }}
        </button>
        <button type="button" :disabled="resetting" @click="resetExperience">
          <LoaderCircle v-if="resetting" class="spin" :size="14" aria-hidden="true" />
          <RotateCcw v-else :size="14" aria-hidden="true" />
          {{ resetting ? '正在重置' : '恢复初始数据' }}
        </button>
      </div>
    </section>
  </div>
</template>
