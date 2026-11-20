<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { KeyRound, LoaderCircle, LockKeyhole, LogOut } from '@lucide/vue'
import { useDormStore } from '../composables/useDormStore'
import { useDialogScrollLock } from '../composables/useDialogScrollLock'

const { state, verifyExistingRoom, unlinkCurrentDevice } = useDormStore()
const creatorKey = ref('')
const submitting = ref(false)
const leaving = ref(false)
const errorMessage = ref('')
const now = ref(Date.now())

const verification = computed(() => state.roomVerification)
const visible = computed(
  () => state.roomVerification?.required === true,
)
const remainingLabel = computed(() => {
  const deadline = verification.value?.deadlineAt || verification.value?.fallbackAt
  if (!deadline) return ''
  const remaining = Math.max(0, Date.parse(deadline) - now.value)
  const hours = Math.floor(remaining / 3_600_000)
  const minutes = Math.ceil((remaining % 3_600_000) / 60_000)
  return hours > 0 ? `${hours} 小时 ${minutes} 分钟` : `${minutes} 分钟`
})

useDialogScrollLock(visible)

const timer = window.setInterval(() => {
  now.value = Date.now()
}, 30_000)

onBeforeUnmount(() => window.clearInterval(timer))

async function verify(): Promise<void> {
  if (!creatorKey.value.trim()) {
    errorMessage.value = '请输入创建密钥'
    return
  }

  submitting.value = true
  errorMessage.value = ''
  try {
    await verifyExistingRoom(creatorKey.value)
    creatorKey.value = ''
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '验证失败，请重试'
  } finally {
    submitting.value = false
  }
}

async function leaveDevice(): Promise<void> {
  leaving.value = true
  try {
    await unlinkCurrentDevice()
  } finally {
    leaving.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="dialog">
      <div v-if="visible" class="dialog-layer" role="presentation">
        <section
          class="room-verification-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="room-verification-title"
        >
          <span class="secret-dialog__icon">
            <LockKeyhole :size="22" stroke-width="1.8" aria-hidden="true" />
          </span>

          <div class="secret-dialog__copy">
            <p class="eyebrow">寝室授权验证</p>
            <h2 id="room-verification-title">
              {{ verification?.isOwner ? '验证这间寝室' : '等待房主完成验证' }}
            </h2>
            <p v-if="verification?.isOwner">
              这是启用寝室授权功能前创建的寝室。请在期限内输入创建密钥，否则寝室和全部记录将被清理。
            </p>
            <p v-else>
              寝室正在等待房主授权。验证完成前，所有成员暂不能查看或修改状态。
            </p>
          </div>

          <p v-if="remainingLabel" class="verification-deadline">
            剩余验证时间 {{ remainingLabel }}
          </p>

          <form v-if="verification?.isOwner" class="verification-form" @submit.prevent="verify">
            <label class="field">
              <span class="field__label">
                <KeyRound :size="16" aria-hidden="true" />
                创建密钥
              </span>
              <input
                v-model="creatorKey"
                type="password"
                maxlength="32"
                autocomplete="off"
                placeholder="请输入寝室创建密钥"
              />
            </label>
            <p v-if="errorMessage" class="form-error">{{ errorMessage }}</p>
            <button type="submit" class="button button--primary" :disabled="submitting">
              <LoaderCircle v-if="submitting" class="spin" :size="17" aria-hidden="true" />
              {{ submitting ? '正在验证…' : '完成验证' }}
            </button>
          </form>

          <button
            type="button"
            class="text-button verification-leave"
            :disabled="leaving"
            @click="leaveDevice"
          >
            <LogOut :size="15" aria-hidden="true" />
            {{ leaving ? '正在退出…' : '退出当前设备' }}
          </button>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>
