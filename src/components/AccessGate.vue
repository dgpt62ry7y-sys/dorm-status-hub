<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  ArrowLeft,
  ArrowRight,
  KeyRound,
  Link2,
  LoaderCircle,
  Plus,
  RefreshCw,
  ShieldCheck,
  Users,
} from 'lucide-vue-next'
import { useDormStore } from '../composables/useDormStore'
import type { RoomCapacity } from '../types/dorm'

const {
  phase,
  actionError,
  createRoom,
  joinRoom,
  linkDevice,
  recoverAccount,
  retryInitialize,
} = useDormStore()

type AccessMode = 'create' | 'join' | 'bind' | 'recover'

const inviteFromUrl = new URLSearchParams(window.location.search).get('invite') || ''
const mode = ref<AccessMode>(inviteFromUrl ? 'join' : 'create')
const roomName = ref('')
const nickname = ref('')
const inviteCode = ref(inviteFromUrl.toUpperCase())
const accountCode = ref('')
const roomCapacity = ref<RoomCapacity>(4)
const capacityOptions: RoomCapacity[] = [4, 6]
const creatorKey = ref('')
const submitting = ref(false)
const formError = ref('')

const submitLabel = computed(() => {
  if (submitting.value) return '正在连接…'
  if (mode.value === 'create') return '创建并进入宿舍'
  if (mode.value === 'join') return '加入宿舍'
  if (mode.value === 'bind') return '绑定这台设备'
  return '恢复我的账号'
})

const intro = computed(() => {
  if (mode.value === 'bind') {
    return '输入原设备生成的 8 位绑定码，让这台设备共享同一个成员身份。'
  }
  if (mode.value === 'recover') {
    return '输入账号恢复码，在没有旧设备的情况下重新进入同一个成员身份。'
  }
  return '这是一个只属于室友的共享状态空间。第一次进入后，手机会记住你的成员身份。'
})

function switchMode(nextMode: AccessMode): void {
  mode.value = nextMode
  accountCode.value = ''
  if (nextMode !== 'create') creatorKey.value = ''
  formError.value = ''
}

async function submit(): Promise<void> {
  formError.value = ''

  if (mode.value === 'create' || mode.value === 'join') {
    if (!nickname.value.trim()) {
      formError.value = '请先填写室友们熟悉的昵称'
      return
    }
    if (mode.value === 'create' && !roomName.value.trim()) {
      formError.value = '请填写宿舍名称'
      return
    }
    if (mode.value === 'create' && !creatorKey.value.trim()) {
      formError.value = '请输入创建密钥'
      return
    }
    if (mode.value === 'join' && !inviteCode.value.trim()) {
      formError.value = '请输入邀请码'
      return
    }
  } else if (!accountCode.value.trim()) {
    formError.value = mode.value === 'bind' ? '请输入绑定码' : '请输入恢复码'
    return
  }

  submitting.value = true
  try {
    if (mode.value === 'create') {
      await createRoom(
        roomName.value,
        nickname.value,
        roomCapacity.value,
        creatorKey.value,
      )
    } else if (mode.value === 'join') {
      await joinRoom(inviteCode.value, nickname.value)
    } else if (mode.value === 'bind') {
      await linkDevice(accountCode.value)
    } else {
      await recoverAccount(accountCode.value)
    }
    const url = new URL(window.location.href)
    url.searchParams.delete('invite')
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`)
  } catch (error) {
    formError.value = error instanceof Error ? error.message : '操作失败，请重试'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div v-if="phase === 'loading'" class="access-gate access-gate--loading">
    <span class="access-loader"><LoaderCircle :size="24" aria-hidden="true" /></span>
    <p>正在连接宿舍空间…</p>
  </div>

  <div v-else-if="phase === 'error'" class="access-gate">
    <section class="access-panel">
      <p class="eyebrow">连接失败</p>
      <h1>暂时进不去宿舍</h1>
      <p class="access-intro">{{ actionError || '请检查网络后重试。' }}</p>
      <button type="button" class="button button--primary" @click="retryInitialize">
        <RefreshCw :size="17" aria-hidden="true" />
        重新连接
      </button>
    </section>
  </div>

  <div v-else class="access-gate">
    <section class="access-panel" aria-labelledby="access-heading">
      <p class="eyebrow">宿舍状态共享站 / 云端空间</p>
      <h1 id="access-heading">进入宿舍空间</h1>
      <p class="access-intro">{{ intro }}</p>

      <div
        v-if="mode === 'create' || mode === 'join'"
        class="access-tabs"
        role="tablist"
        aria-label="进入方式"
      >
        <button
          type="button"
          role="tab"
          :aria-selected="mode === 'create'"
          :class="{ active: mode === 'create' }"
          @click="mode = 'create'; formError = ''"
        >
          <Plus :size="16" aria-hidden="true" />
          创建宿舍
        </button>
        <button
          type="button"
          role="tab"
          :aria-selected="mode === 'join'"
          :class="{ active: mode === 'join' }"
          @click="mode = 'join'; formError = ''"
        >
          <Users :size="16" aria-hidden="true" />
          加入宿舍
        </button>
      </div>

      <form class="access-form" @submit.prevent="submit">
        <label v-if="mode === 'create'" class="field">
          <span class="field__label">宿舍名称</span>
          <input v-model="roomName" type="text" maxlength="20" placeholder="输入宿舍名称" />
        </label>

        <fieldset v-if="mode === 'create'" class="field field--fieldset">
          <legend class="field__label">宿舍房型</legend>
          <div class="capacity-options">
            <button
              v-for="capacity in capacityOptions"
              :key="capacity"
              type="button"
              class="capacity-option"
              :class="{ 'capacity-option--active': roomCapacity === capacity }"
              :aria-pressed="roomCapacity === capacity"
              @click="roomCapacity = capacity"
            >
              <Users :size="18" stroke-width="1.8" aria-hidden="true" />
              <span>
                <strong>{{ capacity }} 人寝</strong>
                <small>最多 {{ capacity }} 位成员</small>
              </span>
            </button>
          </div>
        </fieldset>

        <label v-if="mode === 'create'" class="field">
          <span class="field__label">
            <KeyRound :size="16" aria-hidden="true" />
            创建密钥
          </span>
          <input
            v-model="creatorKey"
            type="password"
            maxlength="32"
            autocomplete="off"
            placeholder="请输入授权创建密钥"
          />
        </label>

        <label v-else-if="mode === 'join'" class="field">
          <span class="field__label">
            <KeyRound :size="16" aria-hidden="true" />
            邀请码
          </span>
          <input
            v-model="inviteCode"
            type="text"
            maxlength="8"
            autocapitalize="characters"
            autocomplete="one-time-code"
            placeholder="例如 4B7K9Q"
          />
        </label>

        <label v-if="mode === 'create' || mode === 'join'" class="field">
          <span class="field__label">你的昵称</span>
          <input
            v-model="nickname"
            type="text"
            maxlength="12"
            autocomplete="nickname"
            placeholder="室友们怎么称呼你"
          />
        </label>

        <label v-else class="field">
          <span class="field__label">
            <Link2 v-if="mode === 'bind'" :size="16" aria-hidden="true" />
            <ShieldCheck v-else :size="16" aria-hidden="true" />
            {{ mode === 'bind' ? '设备绑定码' : '账号恢复码' }}
          </span>
          <input
            v-model="accountCode"
            type="text"
            :maxlength="mode === 'bind' ? 12 : 29"
            autocapitalize="characters"
            autocomplete="one-time-code"
            :placeholder="mode === 'bind' ? '输入 8 位绑定码' : 'XXXX-XXXX-XXXX-XXXX-XXXX'"
          />
        </label>

        <div v-if="mode === 'bind' || mode === 'recover'" class="access-account-nav">
          <button
            type="button"
            class="text-button"
            @click="switchMode(inviteFromUrl ? 'join' : 'create')"
          >
            <ArrowLeft :size="15" aria-hidden="true" />
            返回登录
          </button>
          <button
            type="button"
            class="text-button"
            @click="switchMode(mode === 'bind' ? 'recover' : 'bind')"
          >
            {{ mode === 'bind' ? '使用恢复码恢复' : '返回绑定设备' }}
          </button>
        </div>

        <p v-if="formError" class="form-error">{{ formError }}</p>

        <button type="submit" class="button button--primary access-submit" :disabled="submitting">
          <LoaderCircle v-if="submitting" class="spin" :size="17" aria-hidden="true" />
          <ArrowRight v-else :size="17" aria-hidden="true" />
          {{ submitLabel }}
        </button>
      </form>

      <div v-if="mode === 'create' || mode === 'join'" class="access-account-entry">
        <span>已经在另一台设备登录？</span>
        <button type="button" @click="switchMode('bind')">
          <Link2 :size="14" aria-hidden="true" />
          绑定已有账号
        </button>
      </div>

      <p class="access-note">
        每台设备可以单独退出。保存账号恢复码后，更换手机或清除浏览器数据也不会丢失成员身份。
      </p>
    </section>
  </div>
</template>
