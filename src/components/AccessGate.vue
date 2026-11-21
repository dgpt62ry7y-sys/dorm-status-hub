<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  KeyRound,
  Link2,
  LoaderCircle,
  Plus,
  RefreshCw,
  ShieldCheck,
  Users,
} from '@lucide/vue'
import { useDormStore } from '../composables/useDormStore'
import { DORMSYNC_API_URL } from '../config/cloudbase'
import type { RoomCapacity } from '../types/dorm'
import { getLastRoomHint } from '../utils/lastRoom'

const {
  phase,
  actionError,
  createRoom,
  joinRoom,
  linkDevice,
  recoverAccount,
  recoverWithAssistance,
  retryInitialize,
} = useDormStore()

type AccessMode = 'entry' | 'create' | 'join' | 'bind' | 'recover'
type RecoveryMethod = 'code' | 'assistance'
type RecoveryMode = 'member' | 'owner' | 'admin'

const inviteFromUrl = new URLSearchParams(window.location.search).get('invite') || ''
const lastRoomHint = getLastRoomHint()
const initialInviteCode = (inviteFromUrl || lastRoomHint?.inviteCode || '').toUpperCase()
const hasKnownRoom = Boolean(initialInviteCode)
const mode = ref<AccessMode>(hasKnownRoom ? 'entry' : 'create')
const recoveryMethod = ref<RecoveryMethod>('code')
const recoveryRole = ref<RecoveryMode>('member')
const roomName = ref('')
const nickname = ref('')
const inviteCode = ref(initialInviteCode)
const accountCode = ref('')
const assistanceCodeOne = ref('')
const assistanceCodeTwo = ref('')
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
  if (recoveryMethod.value === 'code') return '恢复我的账号'
  return recoveryRole.value === 'admin' ? '使用房主救援码' : '使用临时恢复码'
})

const intro = computed(() => {
  if (mode.value === 'entry') {
    if (inviteFromUrl) {
      return '这个链接已经带上宿舍分享号。请选择你是第一次加入，还是恢复以前使用过的账号。'
    }
    return '我们找到了你上次使用的宿舍。请选择恢复已有账号；如果这是另一位室友的设备，再选择第一次加入。'
  }
  if (mode.value === 'bind') {
    return '输入原设备生成的 8 位绑定码，让这台设备共享同一个成员身份。'
  }
  if (mode.value === 'recover') {
    return recoveryMethod.value === 'code'
      ? '输入宿舍分享号和 20 位账号恢复码，重新绑定原来的成员身份。'
      : recoveryRole.value === 'admin'
        ? '输入宿舍分享号和本地管理台生成的房主救援码。救援码 10 分钟内有效，只能使用一次。'
        : '输入宿舍分享号和已登录成员为你生成的一次性临时恢复码。'
  }
  return '这是一个只属于室友的共享状态空间。第一次进入后，手机会记住你的成员身份。'
})

function switchMode(nextMode: AccessMode): void {
  mode.value = nextMode
  accountCode.value = ''
  assistanceCodeOne.value = ''
  assistanceCodeTwo.value = ''
  recoveryMethod.value = 'code'
  recoveryRole.value = 'member'
  if (nextMode !== 'create') creatorKey.value = ''
  formError.value = ''
}

function resetJoinRequestIfNeeded(): void {
  if (mode.value !== 'join') return
  const url = new URL(window.location.href)
  url.searchParams.delete('invite')
  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`)
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
      formError.value = '请输入六位宿舍分享号'
      return
    }
  } else if (mode.value === 'bind') {
    if (!accountCode.value.trim()) {
      formError.value = '请输入绑定码'
      return
    }
  } else if (mode.value === 'recover') {
    if (!inviteCode.value.trim()) {
      formError.value = '请输入六位宿舍分享号'
      return
    }
    if (recoveryMethod.value === 'code' && !accountCode.value.trim()) {
      formError.value = '请输入 20 位账号恢复码'
      return
    }
    if (recoveryMethod.value === 'assistance' && !assistanceCodeOne.value.trim()) {
      formError.value = '请输入临时恢复码'
      return
    }
    if (
      recoveryMethod.value === 'assistance' &&
      recoveryRole.value === 'owner' &&
      !assistanceCodeTwo.value.trim()
    ) {
      formError.value = '房主恢复需要两个不同成员生成的临时恢复码'
      return
    }
  } else {
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
      if (recoveryMethod.value === 'code') {
        await recoverAccount(inviteCode.value, accountCode.value)
      } else {
        await recoverWithAssistance(
          inviteCode.value,
          recoveryRole.value,
          recoveryRole.value === 'owner'
            ? [assistanceCodeOne.value, assistanceCodeTwo.value]
            : [assistanceCodeOne.value],
        )
      }
    }
    resetJoinRequestIfNeeded()
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
      <div class="access-error-actions">
        <button type="button" class="button button--primary" @click="retryInitialize">
          <RefreshCw :size="17" aria-hidden="true" />
          重新连接
        </button>
        <a
          class="button button--secondary"
          :href="DORMSYNC_API_URL"
          target="_blank"
          rel="noopener noreferrer"
        >
          <ExternalLink :size="17" aria-hidden="true" />
          打开服务确认页
        </a>
      </div>
      <p class="access-service-help">
        如果是首次使用 CloudBase 默认测试域名，请在新页面点击“确定访问”，返回本页后会自动重新连接。
      </p>
    </section>
  </div>

  <div v-else class="access-gate">
    <section class="access-panel" aria-labelledby="access-heading">
      <p class="eyebrow">宿舍状态共享站 / 云端空间</p>
      <h1 id="access-heading">进入宿舍空间</h1>
      <p class="access-intro">{{ intro }}</p>

      <section v-if="mode === 'entry'" class="access-entry">
        <div class="access-entry__share">
          <small>
            {{
              lastRoomHint?.roomName
                ? `上次使用 · ${lastRoomHint.roomName}`
                : '宿舍分享号'
            }}
          </small>
          <strong>{{ inviteCode }}</strong>
        </div>
        <div class="access-entry__actions">
          <button type="button" class="button button--primary" @click="switchMode('join')">
            <Users :size="17" aria-hidden="true" />
            第一次加入
          </button>
          <button type="button" class="button button--secondary" @click="switchMode('recover')">
            <ShieldCheck :size="17" aria-hidden="true" />
            恢复已有账号
          </button>
        </div>
        <button type="button" class="text-button" @click="switchMode('create')">
          创建自己的新宿舍
        </button>
      </section>

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

      <form v-if="mode !== 'entry'" class="access-form" @submit.prevent="submit">
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

        <label v-if="mode === 'join' || mode === 'recover'" class="field">
          <span class="field__label">
            <KeyRound :size="16" aria-hidden="true" />
            宿舍分享号
          </span>
          <input
            v-model="inviteCode"
            type="text"
            maxlength="6"
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

        <template v-if="mode === 'recover'">
          <div class="access-tabs" role="tablist" aria-label="账号恢复方式">
            <button
              type="button"
              role="tab"
              :aria-selected="recoveryMethod === 'code'"
              :class="{ active: recoveryMethod === 'code' }"
              @click="recoveryMethod = 'code'; formError = ''"
            >
              <KeyRound :size="15" aria-hidden="true" />
              我有恢复码
            </button>
            <button
              type="button"
              role="tab"
              :aria-selected="recoveryMethod === 'assistance'"
              :class="{ active: recoveryMethod === 'assistance' }"
              @click="recoveryMethod = 'assistance'; formError = ''"
            >
              <Users :size="15" aria-hidden="true" />
              我忘了恢复码
            </button>
          </div>

          <label v-if="recoveryMethod === 'code'" class="field">
            <span class="field__label">
              <ShieldCheck :size="16" aria-hidden="true" />
              账号恢复码
            </span>
            <input
              v-model="accountCode"
              type="text"
              maxlength="29"
              autocapitalize="characters"
              autocomplete="one-time-code"
              placeholder="XXXX-XXXX-XXXX-XXXX-XXXX"
            />
          </label>

          <template v-else>
            <div
              class="access-tabs access-tabs--three"
              role="tablist"
              aria-label="恢复身份"
            >
              <button
                type="button"
                role="tab"
                :aria-selected="recoveryRole === 'member'"
                :class="{ active: recoveryRole === 'member' }"
                @click="recoveryRole = 'member'; formError = ''"
              >
                我是普通成员
              </button>
              <button
                type="button"
                role="tab"
                :aria-selected="recoveryRole === 'owner'"
                :class="{ active: recoveryRole === 'owner' }"
                @click="recoveryRole = 'owner'; formError = ''"
              >
                我是房主
              </button>
              <button
                type="button"
                role="tab"
                :aria-selected="recoveryRole === 'admin'"
                :class="{ active: recoveryRole === 'admin' }"
                @click="recoveryRole = 'admin'; formError = ''"
              >
                本地救援
              </button>
            </div>

            <label class="field">
              <span class="field__label">
                <KeyRound :size="16" aria-hidden="true" />
                {{
                  recoveryRole === 'owner'
                    ? '房主恢复码 A'
                    : recoveryRole === 'admin'
                      ? '房主救援码'
                      : '成员临时恢复码'
                }}
              </span>
              <input
                v-model="assistanceCodeOne"
                type="text"
                maxlength="19"
                autocapitalize="characters"
                autocomplete="one-time-code"
                placeholder="XXXX-XXXX-XXXX-XXXX"
              />
            </label>

            <label v-if="recoveryRole === 'owner'" class="field">
              <span class="field__label">
                <KeyRound :size="16" aria-hidden="true" />
                房主恢复码 B
              </span>
              <input
                v-model="assistanceCodeTwo"
                type="text"
                maxlength="19"
                autocapitalize="characters"
                autocomplete="one-time-code"
                placeholder="由另一名成员生成"
              />
            </label>
          </template>
        </template>

        <label v-if="mode === 'bind'" class="field">
          <span class="field__label">
            <Link2 :size="16" aria-hidden="true" />
            设备绑定码
          </span>
          <input
            v-model="accountCode"
            type="text"
            maxlength="12"
            autocapitalize="characters"
            autocomplete="one-time-code"
            placeholder="输入 8 位绑定码"
          />
        </label>

        <div v-if="mode === 'bind' || mode === 'recover'" class="access-account-nav">
          <button
            type="button"
            class="text-button"
            @click="switchMode(hasKnownRoom ? 'entry' : 'create')"
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
        <span>以前用过 DormSync？</span>
        <div>
          <button type="button" @click="switchMode('recover')">
            <ShieldCheck :size="14" aria-hidden="true" />
            恢复账号
          </button>
          <button type="button" @click="switchMode('bind')">
            <Link2 :size="14" aria-hidden="true" />
            绑定已有设备
          </button>
        </div>
      </div>

      <p class="access-note">
        每台设备可以单独退出。保存账号恢复码后，更换手机或清除浏览器数据也不会丢失成员身份。
      </p>
    </section>
  </div>
</template>
