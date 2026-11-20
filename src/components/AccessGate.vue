<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  ArrowRight,
  KeyRound,
  LoaderCircle,
  Plus,
  RefreshCw,
  Users,
} from 'lucide-vue-next'
import { useDormStore } from '../composables/useDormStore'

const {
  phase,
  actionError,
  createRoom,
  joinRoom,
  retryInitialize,
} = useDormStore()

const inviteFromUrl = new URLSearchParams(window.location.search).get('invite') || ''
const mode = ref<'create' | 'join'>(inviteFromUrl ? 'join' : 'create')
const roomName = ref('')
const nickname = ref('')
const inviteCode = ref(inviteFromUrl.toUpperCase())
const submitting = ref(false)
const formError = ref('')

const submitLabel = computed(() => {
  if (submitting.value) return '正在连接…'
  return mode.value === 'create' ? '创建并进入宿舍' : '加入宿舍'
})

async function submit(): Promise<void> {
  formError.value = ''
  if (!nickname.value.trim()) {
    formError.value = '请先填写室友们熟悉的昵称'
    return
  }
  if (mode.value === 'create' && !roomName.value.trim()) {
    formError.value = '请填写宿舍名称'
    return
  }
  if (mode.value === 'join' && !inviteCode.value.trim()) {
    formError.value = '请输入邀请码'
    return
  }

  submitting.value = true
  try {
    if (mode.value === 'create') {
      await createRoom(roomName.value, nickname.value)
    } else {
      await joinRoom(inviteCode.value, nickname.value)
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
      <p class="access-intro">
        这是一个只属于室友的共享状态空间。第一次进入后，手机会记住你的成员身份。
      </p>

      <div class="access-tabs" role="tablist" aria-label="进入方式">
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

        <label v-else class="field">
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

        <label class="field">
          <span class="field__label">你的昵称</span>
          <input
            v-model="nickname"
            type="text"
            maxlength="12"
            autocomplete="nickname"
            placeholder="室友们怎么称呼你"
          />
        </label>

        <p v-if="formError" class="form-error">{{ formError }}</p>

        <button type="submit" class="button button--primary access-submit" :disabled="submitting">
          <LoaderCircle v-if="submitting" class="spin" :size="17" aria-hidden="true" />
          <ArrowRight v-else :size="17" aria-hidden="true" />
          {{ submitLabel }}
        </button>
      </form>

      <p class="access-note">
        成员身份保存在当前手机浏览器中。清除浏览器数据后需要重新加入宿舍。
      </p>
    </section>
  </div>
</template>
