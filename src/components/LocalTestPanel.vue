<script setup lang="ts">
import { computed, ref } from 'vue'
import { FlaskConical, LoaderCircle, RotateCcw, Users, X } from 'lucide-vue-next'
import { DORMSYNC_API_URL } from '../config/cloudbase'

interface TestAccount {
  memberId: string
  nickname: string
  memberToken: string
}

const enabled =
  import.meta.env.DEV && import.meta.env.VITE_LOCAL_TEST_MODE === 'true'
const storageKey = 'dormsync:local-test-accounts:v1'
const tokenKey = 'dormsync:member-token:v1'

const open = ref(false)
const loading = ref(false)
const errorMessage = ref('')
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

async function initialize(): Promise<void> {
  loading.value = true
  errorMessage.value = ''
  try {
    const result = await testAction('__testInitializeSixRoom')
    const nextAccounts = result.accounts as TestAccount[]
    localStorage.setItem(storageKey, JSON.stringify(nextAccounts))
    localStorage.setItem(tokenKey, nextAccounts[0].memberToken)
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
