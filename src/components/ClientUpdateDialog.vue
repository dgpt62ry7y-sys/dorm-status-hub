<script setup lang="ts">
import { computed, ref } from 'vue'
import { LoaderCircle, RefreshCw, ShieldAlert } from '@lucide/vue'
import { useDormStore } from '../composables/useDormStore'
import { useDialogScrollLock } from '../composables/useDialogScrollLock'

const { clientUpdateRequired, latestPublicVersion, refreshToLatest } =
  useDormStore()
const appVersion = __APP_VERSION__
const refreshing = ref(false)
const visible = computed(
  () => !__DEMO_MODE__ && clientUpdateRequired.value,
)

useDialogScrollLock(visible)

async function refresh(): Promise<void> {
  if (refreshing.value) return
  refreshing.value = true
  await refreshToLatest()
}
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="client-update-layer" role="presentation">
      <section
        class="client-update-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="client-update-title"
      >
        <span class="client-update-dialog__icon">
          <ShieldAlert :size="23" stroke-width="1.8" aria-hidden="true" />
        </span>
        <p>REQUIRED UPDATE</p>
        <h2 id="client-update-title">需要更新后才能继续</h2>
        <p class="client-update-dialog__copy">
          当前页面是旧版本，继续操作可能出现数据不同步。刷新后才会恢复正常使用。
        </p>
        <div class="client-update-dialog__versions">
          <span>当前版本</span>
          <strong>{{ appVersion }}</strong>
          <i>→</i>
          <span>最新版本</span>
          <strong>{{ latestPublicVersion || '新版本' }}</strong>
        </div>
        <button
          type="button"
          class="button button--primary"
          :disabled="refreshing"
          @click="refresh"
        >
          <LoaderCircle
            v-if="refreshing"
            class="spin"
            :size="17"
            aria-hidden="true"
          />
          <RefreshCw v-else :size="17" aria-hidden="true" />
          {{ refreshing ? '正在刷新…' : '立即刷新' }}
        </button>
      </section>
    </div>
  </Teleport>
</template>
