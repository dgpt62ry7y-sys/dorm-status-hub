<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { ArrowUpRight, BellRing, Share2, X } from '@lucide/vue'
import AppToast from '../components/AppToast.vue'
import MemberRosterItem from '../components/MemberRosterItem.vue'
import QuietBanner from '../components/QuietBanner.vue'
import StatusActionPanel from '../components/StatusActionPanel.vue'
import StatusIcon from '../components/StatusIcon.vue'
import StatusSheet from '../components/StatusSheet.vue'
import { useDormStore } from '../composables/useDormStore'
import {
  getStatusOption,
  isTimedStatus,
  type DormStatus,
  type StatusUpdate,
} from '../types/dorm'
import { formatHeaderDate, getEffectiveStatus } from '../utils/time'
import { shareDemoExperience, shareDormInvite } from '../utils/share'

const {
  state,
  currentMember,
  memberCount,
  availableSeats,
  saveStatus,
  notificationTopicUpdateAvailable,
} = useDormStore()
const demoMode = __DEMO_MODE__

const now = ref(new Date())
const sheetOpen = ref(false)
const sheetStatus = ref<DormStatus>('normal')
const toastMessage = ref('')
const toastVisible = ref(false)
const notificationNudgeDismissedAt = ref(
  localStorage.getItem('dormsync:notification-nudge-dismissed:v1') || '',
)
let clockTimer: number | undefined
let toastTimer: number | undefined

const currentRecord = computed(() => {
  const record = state.statuses.find((item) => item.memberId === state.currentMemberId)
  if (!record) {
    return {
      memberId: state.currentMemberId,
      status: state.preferences.defaultStatus,
      note: '',
      updatedAt: new Date().toISOString(),
      endAt: null,
    }
  }
  return getEffectiveStatus(record, now.value)
})

const currentOption = computed(() => getStatusOption(currentRecord.value.status))
const orderedMembers = computed(() =>
  [...state.members].sort((a, b) =>
    a.id === state.currentMemberId ? -1 : b.id === state.currentMemberId ? 1 : 0,
  ),
)
const currentClock = computed(() =>
  new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    hourCycle: 'h23',
  }).format(now.value),
)
const avatarMembers = computed(() =>
  [...state.members].sort((a, b) =>
    a.id === state.currentMemberId ? -1 : b.id === state.currentMemberId ? 1 : 0,
  ),
)
const showNotificationNudge = computed(
  () =>
    notificationTopicUpdateAvailable.value &&
    notificationNudgeDismissedAt.value !==
      (state.room.notificationTopicUpdatedAt || 'current'),
)

function recordFor(memberId: string) {
  const record = state.statuses.find((item) => item.memberId === memberId)
  if (!record) {
    return {
      memberId,
      status: 'normal' as DormStatus,
      note: '',
      updatedAt: new Date().toISOString(),
      endAt: null,
    }
  }
  return getEffectiveStatus(record, now.value)
}

function showToast(message: string): void {
  toastMessage.value = message
  toastVisible.value = true
  if (toastTimer) window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => {
    toastVisible.value = false
  }, 2400)
}

async function chooseStatus(status: DormStatus): Promise<void> {
  if (isTimedStatus(status)) {
    openStatusSheet(status)
    return
  }

  try {
    const warning = await saveStatus({
      status,
      note: '',
      endAt: null,
    })
    showToast(warning || `已更新为「${getStatusOption(status).label}」`)
  } catch (error) {
    showToast(error instanceof Error ? error.message : '状态更新失败，请重试')
  }
}

function openStatusSheet(status: DormStatus): void {
  sheetStatus.value = status
  sheetOpen.value = true
}

function dismissNotificationNudge(): void {
  const marker = state.room.notificationTopicUpdatedAt || 'current'
  notificationNudgeDismissedAt.value = marker
  localStorage.setItem('dormsync:notification-nudge-dismissed:v1', marker)
}

async function submitStatus(update: StatusUpdate): Promise<void> {
  try {
    const warning = await saveStatus(update)
    sheetOpen.value = false
    showToast(warning || `已更新为「${getStatusOption(update.status).label}」`)
  } catch (error) {
    showToast(error instanceof Error ? error.message : '状态更新失败，请重试')
  }
}

async function handleShare(): Promise<void> {
  try {
    const result = __DEMO_MODE__
      ? await shareDemoExperience()
      : await shareDormInvite(state.room.name, state.room.inviteCode)
    showToast(result.message)
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return
    showToast('暂时无法分享，请使用浏览器地址栏复制链接')
  }
}

onMounted(() => {
  clockTimer = window.setInterval(() => {
    now.value = new Date()
  }, 30_000)
})

onBeforeUnmount(() => {
  if (clockTimer) window.clearInterval(clockTimer)
  if (toastTimer) window.clearTimeout(toastTimer)
})
</script>

<template>
  <div class="page home-page">
    <section class="page-hero">
      <div>
        <p class="eyebrow">
          {{ formatHeaderDate(now) }}
          <span aria-hidden="true">/</span>
          实时状态
        </p>
        <h1>{{ state.room.name }}</h1>
        <p class="page-intro">
          {{ memberCount }} 位室友
          <span aria-hidden="true">·</span>
          <template v-if="availableSeats > 0">还可邀请 {{ availableSeats }} 人</template>
          <template v-else>宿舍已满员</template>
        </p>
      </div>

      <div class="hero-tools">
        <div class="hero-time">
          <span class="live-dot" aria-hidden="true"></span>
          <strong>{{ currentClock }}</strong>
          <small>本地时间</small>
        </div>
        <div class="hero-actions">
          <div class="avatar-stack" :aria-label="`${memberCount} 位宿舍成员`">
            <span
              v-for="member in avatarMembers"
              :key="member.id"
              :class="{ 'avatar-stack__mine': member.id === state.currentMemberId }"
            >
              {{ Array.from(member.nickname)[0] }}
            </span>
          </div>
          <button type="button" class="button button--secondary" @click="handleShare">
            <Share2 :size="17" stroke-width="1.8" aria-hidden="true" />
            分享到群
          </button>
        </div>
      </div>
    </section>

    <QuietBanner :statuses="state.statuses" :now="now" />

    <aside v-if="showNotificationNudge" class="notification-nudge">
      <RouterLink to="/settings" class="notification-nudge__main">
        <span class="notification-nudge__icon" aria-hidden="true">
          <BellRing :size="19" stroke-width="1.8" />
        </span>
        <span class="notification-nudge__copy">
          <small>宿舍通知</small>
          <strong>室友改状态时，把提醒发到手机</strong>
          <p>每个宿舍共用一个独立频道，可在设置页复制或订阅。</p>
        </span>
        <span class="notification-nudge__action">
          去开启
          <ArrowUpRight :size="15" stroke-width="1.8" aria-hidden="true" />
        </span>
      </RouterLink>
      <button
        type="button"
        class="notification-nudge__dismiss"
        aria-label="暂时隐藏宿舍通知提醒"
        @click="dismissNotificationNudge"
      >
        <X :size="15" aria-hidden="true" />
      </button>
    </aside>

    <div class="home-layout">
      <section class="status-section" aria-labelledby="status-heading">
        <div class="section-heading">
          <div>
            <p class="eyebrow">此刻</p>
            <h2 id="status-heading">谁在做什么</h2>
          </div>
          <span class="section-meta">{{ memberCount }} 位成员</span>
        </div>

        <div class="roster-frame">
          <MemberRosterItem
            v-for="(member, index) in orderedMembers"
            :key="member.id"
            :member="member"
            :record="recordFor(member.id)"
            :now="now"
            :mine="member.id === state.currentMemberId"
            :style="{ '--reveal-index': index }"
            @edit="openStatusSheet(currentRecord.status)"
          />
        </div>

        <p class="roster-footnote">
          状态到期后会自动恢复为正常活动，页面上的时间会保持更新。
        </p>
      </section>

      <aside class="my-status-panel" aria-labelledby="my-status-heading">
        <div class="my-status-heading">
          <div>
            <p class="eyebrow">快捷切换</p>
            <h2 id="my-status-heading">我的状态</h2>
          </div>
          <span
            class="current-status"
            :style="{
              '--status-tone': currentOption.tone,
              '--status-soft': currentOption.softTone,
            }"
          >
            <StatusIcon :status="currentRecord.status" :size="15" />
            {{ currentOption.label }}
          </span>
        </div>

        <div class="my-status-person">
          <span class="avatar avatar--large" aria-hidden="true">
            {{ currentMember ? Array.from(currentMember.nickname)[0] : '我' }}
          </span>
          <div>
            <strong>{{ currentMember?.nickname ?? '我' }}</strong>
            <p>只有你可以修改自己的状态</p>
          </div>
        </div>

        <StatusActionPanel
          :active-status="currentRecord.status"
          @choose="chooseStatus"
        />

        <RouterLink v-if="!demoMode" to="/members" class="invite-nudge">
          <span>
            <small>邀请码</small>
            <strong>{{ state.room.inviteCode }}</strong>
          </span>
          <span class="invite-nudge__action">
            分享给室友
            <ArrowUpRight :size="16" stroke-width="1.8" aria-hidden="true" />
          </span>
        </RouterLink>
      </aside>
    </div>

    <StatusSheet
      :open="sheetOpen"
      :status="sheetStatus"
      @close="sheetOpen = false"
      @submit="submitStatus"
    />
    <AppToast :message="toastMessage" :visible="toastVisible" />
  </div>
</template>
