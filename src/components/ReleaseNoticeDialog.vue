<script setup lang="ts">
import { computed, ref } from 'vue'
import { LoaderCircle, Sparkles } from '@lucide/vue'
import { useDormStore } from '../composables/useDormStore'
import { useDialogScrollLock } from '../composables/useDialogScrollLock'

const {
  releaseNoticeDialog,
  releaseNoticeVisible,
  acknowledgeReleaseNotice,
} = useDormStore()
const saving = ref(false)
const errorMessage = ref('')

useDialogScrollLock(releaseNoticeVisible)

const versionRange = computed(() => {
  const notice = releaseNoticeDialog.value
  return notice ? `${notice.fromVersion} → ${notice.toVersion}` : ''
})

async function acknowledge(): Promise<void> {
  const notice = releaseNoticeDialog.value
  if (!notice || saving.value) return

  saving.value = true
  errorMessage.value = ''
  try {
    await acknowledgeReleaseNotice(notice.id)
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
      <div v-if="releaseNoticeVisible" class="dialog-layer" role="presentation">
        <section
          class="release-notice-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="release-notice-title"
        >
          <div class="release-notice-dialog__heading">
            <span class="secret-dialog__icon">
              <Sparkles :size="22" stroke-width="1.8" aria-hidden="true" />
            </span>
            <span class="release-version">{{ versionRange }}</span>
          </div>

          <div class="secret-dialog__copy">
            <p class="eyebrow">产品更新</p>
            <h2 id="release-notice-title">宿舍状态共享站更新</h2>
            <p>这里汇总了你上次阅读之后新增的实用内容。</p>
          </div>

          <div class="release-note-list">
            <ul>
              <li v-for="item in releaseNoticeDialog?.items" :key="item">
                {{ item }}
              </li>
            </ul>
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
