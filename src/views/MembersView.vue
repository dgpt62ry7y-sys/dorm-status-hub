<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { Crown, KeyRound, RefreshCw, Share2, UserMinus, UserRound } from '@lucide/vue'
import AppToast from '../components/AppToast.vue'
import { useDormStore } from '../composables/useDormStore'
import { formatDateLabel } from '../utils/time'
import {
  getDemoExperienceUrl,
  shareDemoExperience,
  shareDormInvite,
} from '../utils/share'

const {
  state,
  availableSeats,
  isOwner,
  regenerateInvite,
  removeMember,
} = useDormStore()
const toastMessage = ref('')
const toastVisible = ref(false)
const demoMode = __DEMO_MODE__
const regenerating = ref(false)
const removingId = ref('')
let toastTimer: number | undefined

const inviteUrl = computed(() => {
  if (demoMode) return getDemoExperienceUrl()
  const url = new URL(window.location.origin)
  url.searchParams.set('invite', state.room.inviteCode)
  return url.toString()
})

function showToast(message: string): void {
  toastMessage.value = message
  toastVisible.value = true
  if (toastTimer) window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => {
    toastVisible.value = false
  }, 2400)
}

async function handleShare(): Promise<void> {
  try {
    const result = demoMode
      ? await shareDemoExperience()
      : await shareDormInvite(state.room.name, state.room.inviteCode)
    showToast(result.message)
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return
    showToast('暂时无法分享，请手动复制邀请码')
  }
}

async function handleRegenerate(): Promise<void> {
  if (!window.confirm('重新生成后，旧邀请码会立即失效。继续吗？')) return
  regenerating.value = true
  try {
    await regenerateInvite()
    showToast('邀请码已更新')
  } catch (error) {
    showToast(error instanceof Error ? error.message : '更新失败，请重试')
  } finally {
    regenerating.value = false
  }
}

async function handleRemove(memberId: string, nickname: string): Promise<void> {
  if (!window.confirm(`确定将「${nickname}」移出宿舍吗？`)) return
  removingId.value = memberId
  try {
    await removeMember(memberId)
    showToast(`已将「${nickname}」移出宿舍`)
  } catch (error) {
    showToast(error instanceof Error ? error.message : '移除失败，请重试')
  } finally {
    removingId.value = ''
  }
}

onBeforeUnmount(() => {
  if (toastTimer) window.clearTimeout(toastTimer)
})
</script>

<template>
  <div class="page members-page">
    <section class="page-hero page-hero--compact">
      <div>
        <p class="eyebrow">{{ state.room.name }} / 室友</p>
        <h1>同住的人</h1>
        <p class="page-intro">
          {{ state.members.length }} / {{ state.room.capacity }} 已加入
          <span aria-hidden="true">·</span>
          一个安静、熟悉的小空间
        </p>
      </div>
      <button type="button" class="button button--primary" @click="handleShare">
        <Share2 :size="17" stroke-width="1.8" aria-hidden="true" />
        {{ demoMode ? '分享体验版' : '分享邀请' }}
      </button>
    </section>

    <section class="invite-band" aria-labelledby="invite-heading">
      <div class="invite-band__symbol" aria-hidden="true">
        <KeyRound :size="24" stroke-width="1.7" />
      </div>
      <div class="invite-band__copy">
        <h2 id="invite-heading">{{ demoMode ? '分享体验版' : '邀请室友加入' }}</h2>
        <p v-if="demoMode">
          体验版使用浏览器内存虚拟数据。把链接分享给朋友，每个人都会得到独立演示。
        </p>
        <p v-else>把链接或邀请码发到宿舍群，对方点击后即可加入。</p>
      </div>
      <div class="invite-band__code">
        <span>{{ demoMode ? '体验模式' : '邀请码' }}</span>
        <strong>{{ demoMode ? '虚拟' : state.room.inviteCode }}</strong>
        <button
          v-if="isOwner && !demoMode"
          type="button"
          class="invite-regenerate"
          :disabled="regenerating"
          @click="handleRegenerate"
        >
          <RefreshCw :size="12" aria-hidden="true" />
          {{ regenerating ? '更新中' : '换一个' }}
        </button>
      </div>
      <button type="button" class="button button--light" @click="handleShare">
        <Share2 :size="17" stroke-width="1.8" aria-hidden="true" />
        {{ demoMode ? '复制体验链接' : '发到群里' }}
      </button>
      <p class="invite-band__url">{{ inviteUrl }}</p>
    </section>

    <section class="members-list-section" aria-labelledby="members-heading">
      <div class="section-heading">
        <div>
          <h2 id="members-heading">成员列表</h2>
        </div>
        <span v-if="availableSeats > 0" class="section-meta">空余 {{ availableSeats }} 个位置</span>
        <span v-else class="section-meta">已满员</span>
      </div>

      <div class="members-list">
        <article
          v-for="(member, index) in state.members"
          :key="member.id"
          class="member-row reveal-item"
          :style="{ '--reveal-index': index }"
        >
          <span class="member-row__index">{{ String(index + 1).padStart(2, '0') }}</span>
          <span class="avatar" aria-hidden="true">
            {{ Array.from(member.nickname)[0] }}
          </span>
          <div class="member-row__copy">
            <div>
              <strong>{{ member.nickname }}</strong>
              <span v-if="member.id === state.currentMemberId" class="self-label">你</span>
            </div>
            <p>{{ formatDateLabel(member.joinedAt) }} 加入</p>
          </div>
          <div class="member-row__actions">
            <span class="member-role">
              <Crown v-if="member.role === 'owner'" :size="15" stroke-width="1.8" aria-hidden="true" />
              <UserRound v-else :size="15" stroke-width="1.8" aria-hidden="true" />
              {{ member.role === 'owner' ? '创建者' : '成员' }}
            </span>
            <button
              v-if="isOwner && member.role !== 'owner'"
              type="button"
              class="member-remove"
              :disabled="removingId === member.id"
              :aria-label="`移除${member.nickname}`"
              @click="handleRemove(member.id, member.nickname)"
            >
              <UserMinus :size="16" stroke-width="1.8" aria-hidden="true" />
            </button>
          </div>
        </article>

        <article
          v-for="seat in availableSeats"
          :key="`seat-${seat}`"
          class="member-row member-row--empty reveal-item"
          :style="{ '--reveal-index': state.members.length + seat }"
        >
          <span class="member-row__index">{{ String(state.members.length + seat).padStart(2, '0') }}</span>
          <span class="avatar avatar--empty" aria-hidden="true">+</span>
          <div class="member-row__copy">
            <strong>等待室友加入</strong>
            <p>把邀请码发到宿舍群即可</p>
          </div>
        </article>
      </div>
    </section>

    <AppToast :message="toastMessage" :visible="toastVisible" />
  </div>
</template>
