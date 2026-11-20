<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  FlaskConical,
  Inbox,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  Trash2,
  Users,
  X,
} from '@lucide/vue'
import { DORMSYNC_API_URL } from '../config/cloudbase'

interface TestAccount {
  memberId: string
  nickname: string
  memberToken: string
  recoveryCode?: string
}

interface NotificationMessage {
  id: number
  channel?: 'ntfy' | 'bark'
  title: string
  priority: string
  body: string
  receivedAt: string
  deviceCount?: number
}

const enabled =
  import.meta.env.DEV && import.meta.env.VITE_LOCAL_TEST_MODE === 'true'
const storageKey = 'dormsync:local-test-accounts:v1'
const tokenKey = 'dormsync:member-token:v1'
const recoveryKey = 'dormsync:local-test-recovery-code:v1'

const open = ref(false)
const loading = ref(false)
const errorMessage = ref('')
const inbox = ref<NotificationMessage[]>([])
const inboxLoading = ref(false)
const inboxError = ref('')
const accounts = ref<TestAccount[]>(
  JSON.parse(localStorage.getItem(storageKey) || '[]') as TestAccount[],
)
const currentToken = localStorage.getItem(tokenKey) || ''
const initialized = computed(() => accounts.value.length > 0)

async function testAction(action: string): Promise<Record<string, unknown>> {
  const response = await fetch(DORMSYNC_API_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action }),
  })
  const result = await response.json()
  if (!result.ok) throw new Error(result.error?.message || '测试操作失败')
  return result.data
}

async function loadInbox(): Promise<void> {
  inboxLoading.value = true
  inboxError.value = ''
  try {
    const result = await testAction('__testGetNotificationInbox')
    inbox.value = (result.messages as NotificationMessage[]) || []
  } catch (error) {
    inboxError.value = error instanceof Error ? error.message : '收件箱读取失败'
  } finally {
    inboxLoading.value = false
  }
}

async function clearInbox(): Promise<void> {
  inboxLoading.value = true
  inboxError.value = ''
  try {
    await testAction('__testClearNotificationInbox')
    inbox.value = []
  } catch (error) {
    inboxError.value = error instanceof Error ? error.message : '收件箱清空失败'
  } finally {
    inboxLoading.value = false
  }
}

function formatInboxTime(value: string): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    hourCycle: 'h23',
  }).format(date)
}

async function initialize(): Promise<void> {
  loading.value = true
  errorMessage.value = ''
  try {
    const result = await testAction('__testInitializeSixRoom')
    const nextAccounts = result.accounts as TestAccount[]
    localStorage.setItem(storageKey, JSON.stringify(nextAccounts))
    localStorage.setItem(tokenKey, nextAccounts[0].memberToken)
    if (nextAccounts[0].recoveryCode) {
      localStorage.setItem(recoveryKey, nextAccounts[0].recoveryCode)
    }
    window.location.reload()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '初始化失败'
  } finally {
    loading.value = false
  }
}

async function reset(): Promise<void> {
  if (!window.confirm('清除全部本地虚拟寝室、成员和浏览器身份？')) return
  loading.value = true
  errorMessage.value = ''
  try {
    await testAction('__testResetAll')
    localStorage.removeItem(storageKey)
    localStorage.removeItem(tokenKey)
    localStorage.removeItem(recoveryKey)
    window.location.reload()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '重置失败'
  } finally {
    loading.value = false
  }
}

function switchAccount(account: TestAccount): void {
  localStorage.setItem(tokenKey, account.memberToken)
  window.location.reload()
}

watch(open, (isOpen) => {
  if (isOpen) void loadInbox()
})
</script>

<template>
  <div v-if="enabled" class="local-test">
    <button
      v-if="!open"
      type="button"
      class="local-test__trigger"
      @click="open = true"
    >
      <FlaskConical :size="16" aria-hidden="true" />
      本地测试
      <i v-if="initialized">{{ accounts.length }}</i>
    </button>

    <section v-else class="local-test__panel" aria-label="本地六账号测试面板">
      <header>
        <span>
          <FlaskConical :size="17" aria-hidden="true" />
          本地测试环境
        </span>
        <button type="button" aria-label="关闭测试面板" @click="open = false">
          <X :size="16" aria-hidden="true" />
        </button>
      </header>

      <div v-if="!initialized" class="local-test__empty">
        <p>当前为空白虚拟环境。初始化后会创建一个六人寝和六个可切换账号。</p>
        <button type="button" :disabled="loading" @click="initialize">
          <LoaderCircle v-if="loading" class="spin" :size="16" aria-hidden="true" />
          <Users v-else :size="16" aria-hidden="true" />
          {{ loading ? '正在创建…' : '初始化六人寝' }}
        </button>
      </div>

      <div v-else class="local-test__accounts">
        <p>点击账号即可切换当前浏览器身份。</p>
        <button
          v-for="account in accounts"
          :key="account.memberId"
          type="button"
          :class="{ active: account.memberToken === currentToken }"
          @click="switchAccount(account)"
        >
          <span>{{ account.nickname.slice(-1) }}</span>
          {{ account.nickname }}
          <i v-if="account.memberToken === currentToken">当前</i>
        </button>
      </div>

      <section class="local-test__inbox" aria-label="本地通知收件箱">
        <header>
          <span>
            <Inbox :size="15" aria-hidden="true" />
            通知收件箱
            <i>{{ inbox.length }}</i>
          </span>
          <div>
            <button
              type="button"
              aria-label="刷新通知收件箱"
              :disabled="inboxLoading"
              @click="loadInbox"
            >
              <LoaderCircle v-if="inboxLoading" class="spin" :size="14" aria-hidden="true" />
              <RefreshCw v-else :size="14" aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label="清空通知收件箱"
              :disabled="inboxLoading || inbox.length === 0"
              @click="clearInbox"
            >
              <Trash2 :size="14" aria-hidden="true" />
            </button>
          </div>
        </header>

        <p v-if="inboxError" class="local-test__inbox-error">{{ inboxError }}</p>
        <div v-else-if="inbox.length === 0" class="local-test__inbox-empty">
          本地状态通知会出现在这里，不会发送到真实 ntfy.sh。
        </div>
        <div v-else class="local-test__messages">
          <article v-for="message in inbox" :key="message.id">
            <div>
              <strong>{{ message.title }}</strong>
              <span v-if="message.channel === 'bark'">
                Bark · {{ message.priority }} · {{ message.deviceCount }} 台
              </span>
              <span v-else>ntfy · Priority {{ message.priority }}</span>
            </div>
            <pre>{{ message.body }}</pre>
            <time :datetime="message.receivedAt">{{ formatInboxTime(message.receivedAt) }}</time>
          </article>
        </div>
      </section>

      <p v-if="errorMessage" class="local-test__error">{{ errorMessage }}</p>

      <button
        v-if="initialized"
        type="button"
        class="local-test__reset"
        :disabled="loading"
        @click="reset"
      >
        <RotateCcw :size="15" aria-hidden="true" />
        重置全部虚拟数据
      </button>
    </section>
  </div>
</template>
