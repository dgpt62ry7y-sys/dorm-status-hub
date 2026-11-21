<script setup lang="ts">
import { computed, ref } from 'vue'
import { ArrowRight, LoaderCircle, UsersRound } from '@lucide/vue'
import { useDormStore } from '../composables/useDormStore'
import { useDialogScrollLock } from '../composables/useDialogScrollLock'

const {
  capacityNoticeDialog,
  capacityNoticeVisible,
  acknowledgeCapacityNotice,
} = useDormStore()
const saving = ref(false)
const errorMessage = ref('')

useDialogScrollLock(capacityNoticeVisible)

const title = computed(() =>
  capacityNoticeDialog.value?.to === 6 ? '宿舍已升级为六人寝' : '宿舍已调整为四人寝',
)

async function acknowledge(): Promise<void> {
  const notice = capacityNoticeDialog.value
  if (!notice || saving.value) return

  saving.value = true
  errorMessage.value = ''
  try {
    await acknowledgeCapacityNotice(notice.id)
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '确认失败，请重试'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="dialog">
      <div v-if="capacityNoticeVisible" class="dialog-layer" role="presentation">
        <section
          class="capacity-notice-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="capacity-notice-title"
        >
          <span class="secret-dialog__icon">
            <UsersRound :size="22" stroke-width="1.8" aria-hidden="true" />
          </span>

          <div class="secret-dialog__copy">
            <p class="eyebrow">房型变更</p>
            <h2 id="capacity-notice-title">{{ title }}</h2>
            <p>
              房主已将宿舍容量调整为 {{ capacityNoticeDialog?.to }} 人，宿舍分享号保持不变。
            </p>
          </div>

          <div class="capacity-change">
            <span>
              <small>原房型</small>
              <strong>{{ capacityNoticeDialog?.from }} 人寝</strong>
            </span>
            <ArrowRight :size="18" aria-hidden="true" />
            <span>
              <small>当前房型</small>
              <strong>{{ capacityNoticeDialog?.to }} 人寝</strong>
            </span>
          </div>

          <p v-if="errorMessage" class="form-error">{{ errorMessage }}</p>

          <button
            type="button"
            class="button button--primary"
            :disabled="saving"
            @click="acknowledge"
          >
            <LoaderCircle v-if="saving" class="spin" :size="17" aria-hidden="true" />
            {{ saving ? '正在确认…' : '知道了' }}
          </button>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>
