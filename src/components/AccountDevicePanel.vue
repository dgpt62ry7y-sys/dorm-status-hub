<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  KeyRound,
  Link2,
  LoaderCircle,
  LogOut,
  MonitorSmartphone,
  RefreshCw,
  Trash2,
} from '@lucide/vue'
import { useDormStore } from '../composables/useDormStore'
import SecretCodeDialog from './SecretCodeDialog.vue'

const emit = defineEmits<{
  notify: [message: string]
}>()

const {
  devices,
  devicesLoading,
  createDeviceLink,
  loadDevices,
  revokeDevice,
  rotateRecoveryCode,
  unlinkCurrentDevice,
} = useDormStore()
const router = useRouter()

const bindingLink = ref<{ visible: boolean; code: string; description: string }>({
  visible: false,
  code: '',
  description: '',
})
const creatingLink = ref(false)
const rotatingRecovery = ref(false)
const revokingId = ref('')
const leavingDevice = ref(false)

const sortedDevices = computed(() =>
  [...devices.value].sort((left, right) => {
    if (left.isCurrent) return -1
    if (right.isCurrent) return 1
    return Date.parse(right.lastSeenAt) - Date.parse(left.lastSeenAt)
  }),
)

const canBindDevice = computed(() => devices.value.length < 5)

function formatSeenAt(value: string): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return '最近在线'
  return date.toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

async function refreshDevices(): Promise<void> {
  try {
    await loadDevices()
  } catch (error) {
    emit('notify', error instanceof Error ? error.message : '设备列表加载失败')
  }
}

async function handleCreateLink(): Promise<void> {
  if (!canBindDevice.value) {
    emit('notify', '账号已经绑定 5 台设备，请先移除一台')
    return
  }

  creatingLink.value = true
  try {
    const result = await createDeviceLink()
    const expiresAt = new Date(result.expiresAt).toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
    })
    bindingLink.value = {
      visible: true,
      code: result.code,
      description: `在另一台设备选择“绑定已有账号”并输入此代码。${expiresAt} 前有效，且只能使用一次。`,
    }
  } catch (error) {
    emit('notify', error instanceof Error ? error.message : '绑定码生成失败')
  } finally {
    creatingLink.value = false
  }
}

async function handleRotateRecovery(): Promise<void> {
  if (!window.confirm('重新生成后，之前保存的恢复码会立即失效。确认继续吗？')) return
  rotatingRecovery.value = true
  try {
    await rotateRecoveryCode()
  } catch (error) {
    emit('notify', error instanceof Error ? error.message : '恢复码生成失败')
  } finally {
    rotatingRecovery.value = false
  }
}

async function handleRevoke(deviceId: string, label: string): Promise<void> {
  if (!window.confirm(`移除“${label}”后，这台设备需要重新绑定才能进入。确认移除吗？`)) {
    return
  }

  revokingId.value = deviceId
  try {
    await revokeDevice(deviceId)
    emit('notify', '设备已移除')
  } catch (error) {
    emit('notify', error instanceof Error ? error.message : '设备移除失败')
  } finally {
    revokingId.value = ''
  }
}

async function handleLeaveDevice(): Promise<void> {
  if (!window.confirm('退出当前设备不会离开宿舍，之后可以使用恢复码重新进入。确认退出吗？')) {
    return
  }

  leavingDevice.value = true
  try {
    await unlinkCurrentDevice()
    await router.push('/')
  } catch (error) {
    emit('notify', error instanceof Error ? error.message : '退出设备失败')
  } finally {
    leavingDevice.value = false
  }
}

onMounted(() => {
  void refreshDevices()
})
</script>

<template>
  <section class="settings-section account-device-section" aria-labelledby="account-device-heading">
    <div class="settings-section__heading">
      <div>
        <p class="eyebrow">账号与设备</p>
        <h2 id="account-device-heading">同一个身份，多端同步</h2>
      </div>
      <span class="device-count">{{ devices.length }} / 5</span>
    </div>

    <div class="account-actions">
      <button
        type="button"
        class="account-action"
        :disabled="creatingLink || !canBindDevice"
        @click="handleCreateLink"
      >
        <span class="account-action__icon">
          <LoaderCircle v-if="creatingLink" class="spin" :size="18" aria-hidden="true" />
          <Link2 v-else :size="18" aria-hidden="true" />
        </span>
        <span>
          <strong>绑定新设备</strong>
          <small>{{ canBindDevice ? '生成 5 分钟有效绑定码' : '请先移除一台设备' }}</small>
        </span>
      </button>

      <button
        type="button"
        class="account-action"
        :disabled="rotatingRecovery"
        @click="handleRotateRecovery"
      >
        <span class="account-action__icon">
          <LoaderCircle v-if="rotatingRecovery" class="spin" :size="18" aria-hidden="true" />
          <KeyRound v-else :size="18" aria-hidden="true" />
        </span>
        <span>
          <strong>重新生成恢复码</strong>
          <small>旧恢复码会立即失效</small>
        </span>
      </button>
    </div>

    <div class="device-list" aria-live="polite">
      <div class="device-list__heading">
        <span>登录设备</span>
        <button type="button" :disabled="devicesLoading" aria-label="刷新设备列表" @click="refreshDevices">
          <RefreshCw :class="{ spin: devicesLoading }" :size="15" aria-hidden="true" />
        </button>
      </div>

      <p v-if="devicesLoading && !devices.length" class="device-empty">
        <LoaderCircle class="spin" :size="17" aria-hidden="true" />
        正在读取设备
      </p>
      <p v-else-if="!devices.length" class="device-empty">暂无登录设备</p>

      <article
        v-for="device in sortedDevices"
        :key="device.id"
        class="device-row"
        :class="{ 'device-row--current': device.isCurrent }"
      >
        <span class="device-row__icon">
          <MonitorSmartphone :size="18" stroke-width="1.8" aria-hidden="true" />
        </span>
        <span class="device-row__copy">
          <strong>
            {{ device.label }}
            <i v-if="device.isCurrent">当前设备</i>
          </strong>
          <small>最近在线 {{ formatSeenAt(device.lastSeenAt) }}</small>
        </span>
        <button
          v-if="!device.isCurrent"
          type="button"
          class="device-row__remove"
          :aria-label="`移除 ${device.label}`"
          :title="`移除 ${device.label}`"
          :disabled="revokingId === device.id"
          @click="handleRevoke(device.id, device.label)"
        >
          <LoaderCircle v-if="revokingId === device.id" class="spin" :size="16" aria-hidden="true" />
          <Trash2 v-else :size="16" aria-hidden="true" />
        </button>
      </article>
    </div>

    <button
      type="button"
      class="text-button text-button--danger account-leave-device"
      :disabled="leavingDevice"
      @click="handleLeaveDevice"
    >
      <LogOut :size="15" stroke-width="1.8" aria-hidden="true" />
      {{ leavingDevice ? '正在退出…' : '退出当前设备，不移出宿舍' }}
    </button>

    <SecretCodeDialog
      :visible="bindingLink.visible"
      title="绑定这台设备"
      :description="bindingLink.description"
      :code="bindingLink.code"
      confirm-label="关闭"
      @close="bindingLink.visible = false"
      @confirm="bindingLink.visible = false"
    />
  </section>
</template>
