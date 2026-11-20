<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, toRef, watch } from 'vue'
import { Clock, Moon, X } from '@lucide/vue'
import StatusIcon from './StatusIcon.vue'
import {
  getStatusOption,
  isTimedStatus,
  type DormStatus,
  type StatusUpdate,
} from '../types/dorm'
import { buildEndAt, toDateTimeLocal } from '../utils/time'
import { useDialogScrollLock } from '../composables/useDialogScrollLock'

const props = defineProps<{
  open: boolean
  status: DormStatus
}>()

const emit = defineEmits<{
  close: []
  submit: [update: StatusUpdate]
}>()

const note = ref('')
const time = ref('')
const timeTouched = ref(false)
const error = ref('')

const option = computed(() => getStatusOption(props.status))
const needsTime = computed(() => isTimedStatus(props.status))
const requiresTime = computed(
  () => props.status === 'sleep' || props.status === 'away',
)
const endAtInfo = computed(() => (time.value ? buildEndAt(time.value) : null))
const isNextDay = computed(() => endAtInfo.value?.isNextDay ?? false)

function getDefaultTime(status: DormStatus): string {
  const target = new Date()

  if (status === 'sleep') {
    target.setDate(target.getDate() + 1)
    target.setHours(7, 30, 0, 0)
  } else {
    target.setHours(target.getHours() + (status === 'focus' ? 2 : 1), 0, 0, 0)
  }

  return toDateTimeLocal(target)
}

function resetForm(): void {
  note.value = ''
  time.value = needsTime.value ? getDefaultTime(props.status) : ''
  timeTouched.value = false
  error.value = ''
}

function close(): void {
  emit('close')
}

function submit(): void {
  if (requiresTime.value && !time.value) {
    error.value =
      props.status === 'away' ? '请设置预计回寝时间。' : '请设置预计起床时间。'
    timeTouched.value = true
    return
  }

  const endAt = needsTime.value && time.value ? buildEndAt(time.value).endAt : null
  emit('submit', {
    status: props.status,
    note: note.value,
    endAt,
  })
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && props.open) close()
}

watch(
  () => props.open,
  (open) => {
    if (open) resetForm()
  },
)

watch(
  () => props.status,
  () => {
    if (props.open) resetForm()
  },
)

onMounted(() => window.addEventListener('keydown', handleKeydown))
onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeydown)
})

useDialogScrollLock(toRef(props, 'open'))
</script>

<template>
  <Teleport to="body">
    <Transition name="sheet">
      <div v-if="open" class="sheet-layer" role="presentation" @click.self="close">
        <section
          class="status-sheet"
          role="dialog"
          aria-modal="true"
          :aria-labelledby="`status-sheet-${status}`"
          :style="{ '--status-tone': option.tone, '--status-soft': option.softTone }"
        >
          <div class="status-sheet__handle" aria-hidden="true"></div>

          <header class="status-sheet__header">
            <div class="status-sheet__title">
              <span class="status-sheet__icon">
                <StatusIcon :status="status" :size="23" />
              </span>
              <div>
                <p>更新我的状态</p>
                <h2 :id="`status-sheet-${status}`">{{ option.label }}</h2>
              </div>
            </div>
            <button type="button" class="icon-button" aria-label="关闭" @click="close">
              <X :size="20" stroke-width="1.8" />
            </button>
          </header>

          <form class="status-sheet__form" @submit.prevent="submit">
            <label v-if="needsTime" class="field">
              <span class="field__label">
                <Clock :size="16" stroke-width="1.8" aria-hidden="true" />
                {{
                  status === 'sleep'
                    ? '预计起床时间'
                    : status === 'away'
                      ? '预计回寝时间'
                      : '预计结束时间'
                }}
                <em v-if="requiresTime">必填</em>
              </span>
              <input
                v-model="time"
                type="time"
                @change="timeTouched = true"
              />
              <span v-if="isNextDay" class="field__hint">
                <Moon :size="14" stroke-width="1.8" aria-hidden="true" />
                所选时间早于现在，将按明天 {{ time }} 计算。
              </span>
            </label>

            <label class="field">
              <span class="field__label field__label--note">
                留一句话
                <i>{{ Array.from(note).length }}/30</i>
              </span>
              <textarea
                v-model="note"
                rows="3"
                maxlength="30"
                :placeholder="status === 'away' ? '例如：去图书馆，晚点回来' : '可选，室友会看到这句话'"
              ></textarea>
            </label>

            <p v-if="error || (timeTouched && requiresTime && !time)" class="form-error">
              {{ error || (status === 'away' ? '请设置预计回寝时间。' : '请设置预计起床时间。') }}
            </p>

            <div class="status-sheet__actions">
              <button type="button" class="button button--ghost" @click="close">取消</button>
              <button type="submit" class="button button--primary">确认更新</button>
            </div>
          </form>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>
