<script setup lang="ts">
import { onMounted, ref } from 'vue'
import {
  BellRing,
  Check,
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
  ShieldAlert,
  Smartphone,
  Trash2,
} from '@lucide/vue'
import { useDormStore } from '../composables/useDormStore'
import type { BarkDevice } from '../types/dorm'

const emit = defineEmits<{
  notify: [message: string]
}>()

const {
  listBarkDevices,
  registerBarkDevice,
  testBarkNotification,
  removeBarkDevice,
} = useDormStore()
const demoMode = __DEMO_MODE__

const devices = ref<BarkDevice[]>([])
const loading = ref(false)
const registering = ref(false)
const testingId = ref('')
const removingId = ref('')
const configured = ref(true)
const installUrl = ref('https://apps.apple.com/app/id1403753865')
const deviceKey = ref('')
const deviceLabel = ref('')
const keyVisible = ref(false)
const errorMessage = ref('')

function formatTime(value: string | null): string {
  if (!value) return '尚未成功发送'
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return '时间未知'
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date)
}

async function loadDevices(): Promise<void> {
  loading.value = true
  errorMessage.value = ''
  try {
    const result = await listBarkDevices()
    devices.value = result.devices
    configured.value = result.configured
    installUrl.value = result.installUrl
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Bark 设备读取失败'
  } finally {
    loading.value = false
  }
}

async function connectDevice(): Promise<void> {
  if (!deviceKey.value.trim()) {
    errorMessage.value = '请粘贴 Bark Device Key 或测试链接'
    return
  }

  registering.value = true
  errorMessage.value = ''
  try {
    const result = await registerBarkDevice(deviceKey.value, deviceLabel.value)
    const nextDevices = devices.value.filter((item) => item.id !== result.device.id)
    devices.value = [...nextDevices, result.device]
    configured.value = result.configured
    deviceKey.value = ''
    deviceLabel.value = ''
    keyVisible.value = false
    emit('notify', 'Bark 已连接，测试通知发送成功')
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : 'Bark 连接失败，请检查 Key'
  } finally {
    registering.value = false
  }
}

async function testDevice(device: BarkDevice): Promise<void> {
  testingId.value = device.id
  try {
    await testBarkNotification(device.id)
    emit('notify', `已向「${device.label}」发送 Bark 测试通知`)
    await loadDevices()
  } catch (error) {
    emit('notify', error instanceof Error ? error.message : 'Bark 测试通知发送失败')
  } finally {
    testingId.value = ''
  }
}

async function deleteDevice(device: BarkDevice): Promise<void> {
  if (!window.confirm(`删除「${device.label}」的 Bark 推送吗？`)) return
  removingId.value = device.id
  try {
    await removeBarkDevice(device.id)
    devices.value = devices.value.filter((item) => item.id !== device.id)
    emit('notify', 'Bark 设备已删除')
  } catch (error) {
    emit('notify', error instanceof Error ? error.message : 'Bark 设备删除失败')
  } finally {
    removingId.value = ''
  }
}

onMounted(() => {
  void loadDevices()
})
</script>

<template>
  <section class="settings-section bark-panel" aria-labelledby="bark-heading">
    <div class="settings-section__heading">
      <div>
        <p class="eyebrow">iPhone 可选通道</p>
        <h2 id="bark-heading">Bark 设备订阅</h2>
      </div>
      <span class="notification-panel__badge">
        <BellRing :size="15" aria-hidden="true" />
        iOS 可选
      </span>
    </div>

    <p class="notification-panel__intro">
      Bark 仅支持 iPhone 和 iPad，是 ntfy 之外的可选通知通道。你可以任选一种，
      也可以同时开启两种；同一宿舍的所有已登记 Bark 设备会收到相同状态通知。
    </p>

    <div v-if="!configured && !loading" class="notification-alert">
      <ShieldAlert :size="18" aria-hidden="true" />
      <div>
        <strong>Bark 尚未完成服务端配置</strong>
        <p>维护者需要先在云函数环境变量中配置 Bark 加密密钥。</p>
      </div>
    </div>

    <div class="bark-install">
      <Smartphone :size="19" stroke-width="1.8" aria-hidden="true" />
      <div>
        <strong>在 iPhone 或 iPad 安装 Bark</strong>
        <p v-if="demoMode">
          体验版使用预置 Bark 设备演示连接、测试和删除流程，不会接收或保存真实 Device Key。
        </p>
        <p v-else>
          打开 Bark，复制 App 首页的 Device Key 或测试链接，再粘贴到下方。点击连接后，
          DormSync 会先发送测试通知，成功后才会保存。
        </p>
        <a :href="installUrl" target="_blank" rel="noopener noreferrer">
          打开 Bark App Store 页面
        </a>
      </div>
    </div>

    <form v-if="!demoMode" class="bark-form" @submit.prevent="connectDevice">
      <label class="field">
        <span class="field__label">
          <KeyRound :size="15" stroke-width="1.8" aria-hidden="true" />
          Bark Device Key 或测试链接
        </span>
        <span class="bark-key-input">
          <input
            v-model="deviceKey"
            :type="keyVisible ? 'text' : 'password'"
            maxlength="500"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
            placeholder="粘贴 Device Key 或 api.day.app 链接"
          />
          <button
            type="button"
            :aria-label="keyVisible ? '隐藏 Bark Key' : '显示 Bark Key'"
            @click="keyVisible = !keyVisible"
          >
            <EyeOff v-if="keyVisible" :size="16" aria-hidden="true" />
            <Eye v-else :size="16" aria-hidden="true" />
          </button>
        </span>
        <span class="field__hint">只接受 Bark Device Key 或 api.day.app 的 HTTPS 链接。</span>
      </label>

      <label class="field">
        <span class="field__label">设备名称</span>
        <input
          v-model="deviceLabel"
          type="text"
          maxlength="30"
          autocomplete="off"
          placeholder="例如：我的 iPhone"
        />
        <span class="field__hint">仅用于区分自己的 Bark 设备，不会显示给其他宿舍成员。</span>
      </label>

      <button
        type="submit"
        class="button button--primary"
        :disabled="registering || !configured"
      >
        <LoaderCircle v-if="registering" class="spin" :size="16" aria-hidden="true" />
        <Check v-else :size="16" aria-hidden="true" />
        {{ registering ? '正在测试并连接…' : '连接并发送测试通知' }}
      </button>
    </form>

    <p v-if="errorMessage" class="form-error">{{ errorMessage }}</p>

    <div class="bark-devices">
      <div class="bark-devices__heading">
        <strong>我的 Bark 设备</strong>
        <span>{{ devices.length }} / 5</span>
      </div>

      <div v-if="loading" class="notification-loading">
        <LoaderCircle class="spin" :size="17" aria-hidden="true" />
        正在读取 Bark 设备
      </div>
      <p v-else-if="devices.length === 0" class="bark-empty">
        尚未登记 Bark 设备。连接成功后，这台 iPhone 会收到宿舍状态通知。
      </p>
      <div v-else class="bark-device-list">
        <article v-for="device in devices" :key="device.id" class="bark-device">
          <div class="bark-device__identity">
            <span aria-hidden="true">{{ Array.from(device.label)[0] || 'B' }}</span>
            <div>
              <strong>{{ device.label }}</strong>
              <code>{{ device.maskedKey }}</code>
            </div>
          </div>
          <div class="bark-device__meta">
            <small>最近成功：{{ formatTime(device.lastSuccessAt) }}</small>
            <div>
              <button
                type="button"
                :disabled="testingId === device.id"
                @click="testDevice(device)"
              >
                <LoaderCircle
                  v-if="testingId === device.id"
                  class="spin"
                  :size="14"
                  aria-hidden="true"
                />
                <BellRing v-else :size="14" aria-hidden="true" />
                测试
              </button>
              <button
                type="button"
                class="bark-device__remove"
                :disabled="removingId === device.id"
                @click="deleteDevice(device)"
              >
                <LoaderCircle
                  v-if="removingId === device.id"
                  class="spin"
                  :size="14"
                  aria-hidden="true"
                />
                <Trash2 v-else :size="14" aria-hidden="true" />
                删除
              </button>
            </div>
          </div>
        </article>
      </div>
    </div>

    <div class="notification-security">
      <KeyRound :size="18" aria-hidden="true" />
      <p>
        Bark Device Key 等同于推送凭证。DormSync 会加密保存，页面只显示末 4 位。
        不要截图、发送给其他人或提交到公开仓库。
      </p>
    </div>
  </section>
</template>
