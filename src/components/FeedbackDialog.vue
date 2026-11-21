<script setup lang="ts">
import { computed, onBeforeUnmount, ref, toRef, watch } from 'vue'
import { Check, LoaderCircle, MessageSquarePlus, Plus, Send, Trash2, X } from '@lucide/vue'
import { useDormStore } from '../composables/useDormStore'
import { useDialogScrollLock } from '../composables/useDialogScrollLock'
import type { FeedbackPage } from '../types/dorm'

const props = defineProps<{
  visible: boolean
  page: FeedbackPage
}>()

const emit = defineEmits<{
  close: []
}>()

const { submitFeedback } = useDormStore()
const items = ref([''])
const contact = ref('')
const submitting = ref(false)
const submitted = ref(false)
const errorMessage = ref('')

const canAdd = computed(() => items.value.length < 5)
const canSubmit = computed(
  () => items.value.some((item) => item.trim()) && !submitting.value,
)

useDialogScrollLock(toRef(props, 'visible'))

function reset(): void {
  items.value = ['']
  contact.value = ''
  submitting.value = false
  submitted.value = false
  errorMessage.value = ''
}

function addItem(): void {
  if (canAdd.value) items.value.push('')
}

function removeItem(index: number): void {
  if (items.value.length === 1) return
  items.value.splice(index, 1)
}

function close(): void {
  if (!submitting.value) emit('close')
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') close()
}

async function submit(): Promise<void> {
  const normalized = items.value
    .map((item) => item.trim())
    .filter(Boolean)
  if (normalized.length === 0) {
    errorMessage.value = '请至少填写一个反馈项目'
    return
  }

  submitting.value = true
  errorMessage.value = ''
  try {
    await submitFeedback(normalized, contact.value.trim(), props.page)
    submitted.value = true
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : '反馈提交失败，请稍后重试'
  } finally {
    submitting.value = false
  }
}

watch(
  () => props.visible,
  (visible) => {
    if (visible) {
      reset()
      document.addEventListener('keydown', handleKeydown)
    } else {
      document.removeEventListener('keydown', handleKeydown)
    }
  },
)

onBeforeUnmount(() => {
  document.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <Teleport to="body">
    <Transition name="feedback-dialog">
      <div v-if="visible" class="feedback-layer" role="presentation" @click.self="close">
        <section
          class="feedback-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="feedback-title"
        >
          <header class="feedback-dialog__header">
            <span class="feedback-dialog__icon">
              <MessageSquarePlus :size="21" stroke-width="1.8" aria-hidden="true" />
            </span>
            <div>
              <p>FEEDBACK</p>
              <h2 id="feedback-title">{{ submitted ? '反馈已提交' : '给维护者反馈' }}</h2>
            </div>
            <button
              type="button"
              class="feedback-dialog__close"
              aria-label="关闭"
              :disabled="submitting"
              @click="close"
            >
              <X :size="18" aria-hidden="true" />
            </button>
          </header>

          <div v-if="submitted" class="feedback-success">
            <span><Check :size="22" stroke-width="2" aria-hidden="true" /></span>
            <strong>已经收到你的反馈</strong>
            <p>反馈已保存到管理台，并会立即提醒维护者。</p>
            <button type="button" class="button button--primary" @click="close">
              关闭
            </button>
          </div>

          <form v-else class="feedback-form" @submit.prevent="submit">
            <p class="feedback-form__intro">
              可以分点描述问题或建议。请勿填写密码、恢复码或成员令牌。
            </p>

            <div class="feedback-items">
              <label
                v-for="(item, index) in items"
                :key="index"
                class="feedback-item"
              >
                <span class="feedback-item__label">
                  <strong>反馈项目 {{ index + 1 }}</strong>
                  <small>{{ Array.from(item).length }}/300</small>
                  <button
                    v-if="items.length > 1"
                    type="button"
                    aria-label="删除这个反馈项目"
                    @click="removeItem(index)"
                  >
                    <Trash2 :size="15" aria-hidden="true" />
                  </button>
                </span>
                <textarea
                  v-model="items[index]"
                  rows="3"
                  maxlength="300"
                  :placeholder="index === 0 ? '请描述遇到的问题或希望改进的地方' : '继续补充一项'"
                ></textarea>
              </label>

              <button
                v-if="canAdd"
                type="button"
                class="feedback-add"
                @click="addItem"
              >
                <Plus :size="16" aria-hidden="true" />
                增加一个反馈项目
              </button>
            </div>

            <label class="feedback-contact">
              <span>联系方式 <small>选填</small></span>
              <input
                v-model="contact"
                type="text"
                maxlength="100"
                placeholder="微信、QQ 或邮箱，方便必要时联系你"
              />
            </label>

            <p v-if="errorMessage" class="form-error">{{ errorMessage }}</p>

            <div class="feedback-form__actions">
              <button type="button" class="button button--ghost" @click="close">
                取消
              </button>
              <button
                type="submit"
                class="button button--primary"
                :disabled="!canSubmit"
              >
                <LoaderCircle
                  v-if="submitting"
                  class="spin"
                  :size="16"
                  aria-hidden="true"
                />
                <Send v-else :size="16" aria-hidden="true" />
                {{ submitting ? '正在提交…' : '提交反馈' }}
              </button>
            </div>
          </form>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>
