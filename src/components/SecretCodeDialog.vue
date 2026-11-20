<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { Check, Copy, ShieldCheck, X } from 'lucide-vue-next'

const props = withDefaults(
  defineProps<{
    visible: boolean
    title: string
    description: string
    code: string
    required?: boolean
    confirmLabel?: string
  }>(),
  {
    required: false,
    confirmLabel: '完成',
  },
)

const emit = defineEmits<{
  close: []
  confirm: []
}>()

const copied = ref(false)
let copyTimer: number | undefined

async function copyCode(): Promise<void> {
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable')
    await navigator.clipboard.writeText(props.code)
  } catch {
    const textarea = document.createElement('textarea')
    textarea.value = props.code
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    textarea.remove()
  }

  copied.value = true
  if (copyTimer) window.clearTimeout(copyTimer)
  copyTimer = window.setTimeout(() => {
    copied.value = false
  }, 1800)
}

function close(): void {
  if (!props.required) emit('close')
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') close()
}

watch(
  () => props.visible,
  (visible) => {
    copied.value = false
    if (visible) document.addEventListener('keydown', handleKeydown)
    else document.removeEventListener('keydown', handleKeydown)
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  document.removeEventListener('keydown', handleKeydown)
  if (copyTimer) window.clearTimeout(copyTimer)
})
</script>

<template>
  <Teleport to="body">
    <Transition name="dialog">
      <div v-if="visible" class="dialog-layer" role="presentation" @click.self="close">
        <section
          class="secret-dialog"
          role="dialog"
          aria-modal="true"
          :aria-labelledby="`secret-title-${code}`"
        >
          <button
            v-if="!required"
            type="button"
            class="secret-dialog__close"
            aria-label="关闭"
            @click="close"
          >
            <X :size="18" aria-hidden="true" />
          </button>

          <span class="secret-dialog__icon">
            <ShieldCheck :size="22" stroke-width="1.8" aria-hidden="true" />
          </span>

          <div class="secret-dialog__copy">
            <p class="eyebrow">账号安全</p>
            <h2 :id="`secret-title-${code}`">{{ title }}</h2>
            <p>{{ description }}</p>
          </div>

          <div class="secret-code" aria-label="账号代码">
            <code>{{ code }}</code>
            <button type="button" :aria-label="copied ? '已复制' : '复制代码'" @click="copyCode">
              <Check v-if="copied" :size="17" aria-hidden="true" />
              <Copy v-else :size="17" aria-hidden="true" />
              {{ copied ? '已复制' : '复制' }}
            </button>
          </div>

          <button type="button" class="button button--primary" @click="emit('confirm')">
            {{ confirmLabel }}
          </button>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>
