<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  BookOpenText,
  Check,
  ChevronDown,
  Info,
  LogOut,
  ShieldCheck,
  UserRound,
} from '@lucide/vue'
import AccountDevicePanel from '../components/AccountDevicePanel.vue'
import AppToast from '../components/AppToast.vue'
import BarkNotificationPanel from '../components/BarkNotificationPanel.vue'
import NotificationSettingsPanel from '../components/NotificationSettingsPanel.vue'
import RoomCapacityPanel from '../components/RoomCapacityPanel.vue'
import StatusIcon from '../components/StatusIcon.vue'
import { useDormStore } from '../composables/useDormStore'
import { LATEST_RELEASE_VERSION, RELEASE_LOG } from '../data/releases'
import { STATUS_OPTIONS, type DormStatus } from '../types/dorm'

const {
  state,
  currentMember,
  updateAvailable,
  refreshToLatest,
  saveProfile,
  leaveRoom,
} = useDormStore()
const router = useRouter()
const appVersion = __APP_VERSION__

const nickname = ref(currentMember.value?.nickname ?? '')
const defaultStatus = ref<DormStatus>(state.preferences.defaultStatus)
const toastMessage = ref('')
const toastVisible = ref(false)
const saving = ref(false)
const leaving = ref(false)
const releaseLogOpen = ref(false)
let toastTimer: number | undefined

function showToast(message: string): void {
  toastMessage.value = message
  toastVisible.value = true
  if (toastTimer) window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => {
    toastVisible.value = false
  }, 2400)
}

async function handleSaveProfile(): Promise<void> {
  if (!nickname.value.trim()) {
    showToast('昵称不能为空')
    return
  }

  saving.value = true
  try {
    await saveProfile(nickname.value, defaultStatus.value)
    nickname.value = currentMember.value?.nickname ?? nickname.value
    showToast('个人设置已同步到云端')
  } catch (error) {
    showToast(error instanceof Error ? error.message : '保存失败，请重试')
  } finally {
    saving.value = false
  }
}

async function handleLeaveRoom(): Promise<void> {
  if (!window.confirm('退出后将无法继续查看宿舍状态，重新加入需要新的邀请码。继续吗？')) {
    return
  }

  leaving.value = true
  try {
    await leaveRoom()
    await router.push('/')
    showToast('已退出宿舍')
  } catch (error) {
    showToast(error instanceof Error ? error.message : '退出失败，请重试')
  } finally {
    leaving.value = false
  }
}

onBeforeUnmount(() => {
  if (toastTimer) window.clearTimeout(toastTimer)
})
</script>

<template>
  <div class="page settings-page">
    <section class="page-hero page-hero--compact">
      <div>
        <p class="eyebrow">宿舍状态共享站 / {{ state.room.name }}</p>
        <h1>设置</h1>
        <p class="page-intro">管理称呼、默认状态、账号恢复和登录设备。</p>
      </div>
      <span class="profile-chip">
        <UserRound :size="17" stroke-width="1.8" aria-hidden="true" />
        {{ currentMember?.nickname }}
      </span>
    </section>

    <div class="settings-layout">
      <div class="settings-main">
        <section class="settings-section" aria-labelledby="profile-heading">
          <div class="settings-section__heading">
            <h2 id="profile-heading">个人信息</h2>
          </div>

          <label class="field">
            <span class="field__label">昵称</span>
            <input
              v-model="nickname"
              type="text"
              maxlength="12"
              autocomplete="nickname"
              placeholder="宿舍里怎么称呼你"
            />
            <span class="field__hint">最多 12 个字符，只在当前宿舍中显示。</span>
          </label>

          <fieldset class="field field--fieldset">
            <legend class="field__label">默认状态</legend>
            <div class="settings-status-grid">
              <button
                v-for="option in STATUS_OPTIONS"
                :key="option.value"
                type="button"
                class="settings-status"
                :class="{ 'settings-status--active': defaultStatus === option.value }"
                :style="{ '--status-tone': option.tone, '--status-soft': option.softTone }"
                @click="defaultStatus = option.value"
              >
                <StatusIcon :status="option.value" :size="17" />
                {{ option.label }}
                <Check
                  v-if="defaultStatus === option.value"
                  :size="15"
                  stroke-width="2.2"
                  aria-hidden="true"
                />
              </button>
            </div>
          </fieldset>

          <button
            type="button"
            class="button button--primary"
            :disabled="saving"
            @click="handleSaveProfile"
          >
            {{ saving ? '正在保存…' : '保存设置' }}
          </button>
        </section>

        <NotificationSettingsPanel @notify="showToast" />

        <BarkNotificationPanel @notify="showToast" />

        <AccountDevicePanel @notify="showToast" />
      </div>

      <aside class="settings-aside">
        <RoomCapacityPanel @notify="showToast" />

        <section class="info-panel" aria-labelledby="demo-heading">
          <div class="info-panel__icon">
            <Info :size="19" stroke-width="1.8" aria-hidden="true" />
          </div>
          <div>
            <h2 id="demo-heading">云端同步已开启</h2>
            <p>
              成员与状态通过 CloudBase 云函数保存，其他室友的设备会自动获取最新变化。
            </p>
          </div>
        </section>

        <section class="settings-list" aria-label="宿舍信息">
          <div>
            <span>当前宿舍</span>
            <strong>{{ state.room.name }}</strong>
          </div>
          <div>
            <span>成员</span>
            <strong>{{ state.members.length }} / {{ state.room.capacity }}</strong>
          </div>
          <div>
            <span>我的身份</span>
            <strong>{{ currentMember?.role === 'owner' ? '创建者' : '成员' }}</strong>
          </div>
          <div class="settings-version-row">
            <span>版本</span>
            <div>
              <strong>{{ appVersion }}</strong>
              <button
                v-if="updateAvailable"
                type="button"
                class="version-update-link"
                @click="refreshToLatest"
              >
                有新版本，请刷新页面
              </button>
            </div>
          </div>
          <div class="settings-release-log">
            <button
              type="button"
              class="settings-release-log__toggle"
              aria-controls="settings-release-log-content"
              :aria-expanded="releaseLogOpen"
              @click="releaseLogOpen = !releaseLogOpen"
            >
              <span class="settings-release-log__label">
                <BookOpenText :size="17" stroke-width="1.8" aria-hidden="true" />
                <span>
                  <strong>功能更新日志</strong>
                  <small>回顾每个版本新增和调整的内容</small>
                </span>
              </span>
              <span class="settings-release-log__meta">
                <small>{{ RELEASE_LOG.length }} 个版本</small>
                <ChevronDown
                  :class="{ 'settings-release-log__chevron--open': releaseLogOpen }"
                  :size="16"
                  stroke-width="1.8"
                  aria-hidden="true"
                />
              </span>
            </button>

            <Transition name="release-log">
              <div
                v-if="releaseLogOpen"
                id="settings-release-log-content"
                class="settings-release-log__content"
              >
                <p v-if="RELEASE_LOG.length === 0" class="settings-release-log__empty">
                  暂无更新记录
                </p>
                <ol v-else>
                  <li v-for="release in RELEASE_LOG" :key="release.version">
                    <header>
                      <strong>V{{ release.version }}</strong>
                      <span v-if="release.version === LATEST_RELEASE_VERSION">最新</span>
                    </header>
                    <ul>
                      <li v-for="item in release.items" :key="item">{{ item }}</li>
                    </ul>
                  </li>
                </ol>
              </div>
            </Transition>
          </div>
        </section>

        <section class="privacy-note">
          <ShieldCheck :size="19" stroke-width="1.8" aria-hidden="true" />
          <p>宿舍状态共享站不采集精确位置、麦克风或摄像头，也不会默认发送打扰性通知。</p>
        </section>

        <button
          type="button"
          class="text-button text-button--danger"
          :disabled="leaving"
          @click="handleLeaveRoom"
        >
          <LogOut :size="15" stroke-width="1.8" aria-hidden="true" />
          {{ leaving ? '正在退出…' : '退出当前宿舍' }}
        </button>
      </aside>
    </div>

    <AppToast :message="toastMessage" :visible="toastVisible" />
  </div>
</template>
