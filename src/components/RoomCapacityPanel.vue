<script setup lang="ts">
import { computed, ref } from 'vue'
import { ArrowRight, LoaderCircle, UsersRound, X } from '@lucide/vue'
import { useDormStore } from '../composables/useDormStore'
import { useDialogScrollLock } from '../composables/useDialogScrollLock'
import type { RoomCapacity } from '../types/dorm'

const emit = defineEmits<{
  notify: [message: string]
}>()

const { state, isOwner, memberCount, updateRoomCapacity } = useDormStore()

const capacityOptions: RoomCapacity[] = [4, 6]
const pendingCapacity = ref<RoomCapacity | null>(null)
const saving = ref(false)
const dialogError = ref('')

const currentCapacity = computed(() => state.room.capacity)
const targetCapacity = computed(() => pendingCapacity.value)
const isDowngrade = computed(
  () => targetCapacity.value === 4 && currentCapacity.value === 6,
)
const dialogVisible = computed(() => Boolean(pendingCapacity.value))

useDialogScrollLock(dialogVisible)

function openDialog(capacity: RoomCapacity): void {
  if (!isOwner.value || capacity === currentCapacity.value) return
  pendingCapacity.value = capacity
  dialogError.value = ''
}

function closeDialog(): void {
  if (saving.value) return
  pendingCapacity.value = null
  dialogError.value = ''
}

async function confirmChange(): Promise<void> {
  if (!targetCapacity.value) return

  saving.value = true
  dialogError.value = ''
  try {
    await updateRoomCapacity(targetCapacity.value)
    emit('notify', `宿舍已调整为${targetCapacity.value}人寝`)
    pendingCapacity.value = null
  } catch (error) {
    dialogError.value = error instanceof Error ? error.message : '房型修改失败'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <section class="capacity-panel" aria-labelledby="capacity-heading">
    <div class="capacity-panel__heading">
      <span class="capacity-panel__icon">
        <UsersRound :size="18" stroke-width="1.8" aria-hidden="true" />
      </span>
      <div>
        <p class="eyebrow">宿舍房型</p>
        <h2 id="capacity-heading">{{ currentCapacity }} 人寝</h2>
      </div>
    </div>

    <p class="capacity-panel__summary">
      当前 {{ memberCount }} 人，最多可容纳 {{ currentCapacity }} 人。
    </p>

    <div v-if="isOwner" class="capacity-panel__options" aria-label="切换宿舍房型">
      <button
        v-for="capacity in capacityOptions"
        :key="capacity"
        type="button"
        :class="{ active: currentCapacity === capacity }"
        :aria-pressed="currentCapacity === capacity"
        :disabled="saving"
        @click="openDialog(capacity)"
      >
        {{ capacity }} 人寝
      </button>
    </div>
    <p v-else class="capacity-panel__hint">只有房主可以修改宿舍房型。</p>

    <Teleport to="body">
      <Transition name="dialog">
        <div
          v-if="pendingCapacity"
          class="dialog-layer"
          role="presentation"
          @click.self="closeDialog"
        >
          <section
            class="capacity-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="capacity-dialog-title"
          >
            <button
              type="button"
              class="secret-dialog__close"
              aria-label="关闭"
              :disabled="saving"
              @click="closeDialog"
            >
              <X :size="18" aria-hidden="true" />
            </button>

            <span class="secret-dialog__icon">
              <UsersRound :size="22" stroke-width="1.8" aria-hidden="true" />
            </span>

            <div class="secret-dialog__copy">
              <p class="eyebrow">房型调整</p>
              <h2 id="capacity-dialog-title">确认切换宿舍房型</h2>
              <p>
                宿舍将从 {{ currentCapacity }} 人寝调整为
                {{ targetCapacity }} 人寝，宿舍分享号保持不变。
              </p>
            </div>

            <div class="capacity-change">
              <span>
                <small>当前</small>
                <strong>{{ currentCapacity }} 人寝</strong>
              </span>
              <ArrowRight :size="18" aria-hidden="true" />
              <span>
                <small>调整后</small>
                <strong>{{ targetCapacity }} 人寝</strong>
              </span>
            </div>

            <p v-if="isDowngrade && memberCount > 4" class="capacity-dialog__warning">
              当前有 {{ memberCount }} 名成员。需要先移除成员到 4 人或更少，降级才能生效。
            </p>
            <p v-if="dialogError" class="form-error">{{ dialogError }}</p>

            <div class="capacity-dialog__actions">
              <button
                type="button"
                class="button button--secondary"
                :disabled="saving"
                @click="closeDialog"
              >
                取消
              </button>
              <button
                type="button"
                class="button button--primary"
                :disabled="saving"
                @click="confirmChange"
              >
                <LoaderCircle v-if="saving" class="spin" :size="17" aria-hidden="true" />
                {{ saving ? '正在调整…' : '确认调整' }}
              </button>
            </div>
          </section>
        </div>
      </Transition>
    </Teleport>
  </section>
</template>
