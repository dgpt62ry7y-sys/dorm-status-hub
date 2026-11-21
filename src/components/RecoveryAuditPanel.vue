<script setup lang="ts">
import { computed, ref } from 'vue'
import { ChevronDown, LoaderCircle, ShieldCheck } from '@lucide/vue'
import { useDormStore } from '../composables/useDormStore'
import type { RecoveryAuditEntry } from '../types/dorm'

const { isOwner, listRecoveryAudit } = useDormStore()
const demoMode = __DEMO_MODE__
const entries = ref<RecoveryAuditEntry[]>([])
const loading = ref(false)
const loaded = ref(false)
const expanded = ref(false)
const errorMessage = ref('')

const visible = computed(() => isOwner.value && !demoMode)

function eventLabel(entry: RecoveryAuditEntry): string {
  if (entry.eventType === 'code_generated') {
    if (entry.method === 'owner_admin_rescue') return '本地管理台生成房主救援码'
    return entry.method === 'owner_assist'
      ? '生成房主临时恢复码'
      : '生成成员临时恢复码'
  }
  if (entry.method === 'owner_admin_rescue') return '房主通过救援码恢复完成'
  if (entry.method === 'owner_assistance') return '房主账号恢复完成'
  if (entry.method === 'member_assistance') return '成员账号恢复完成'
  return '账号恢复完成'
}

function formatAuditTime(value: string): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date)
}

async function load(): Promise<void> {
  if (!visible.value) return
  loading.value = true
  errorMessage.value = ''
  try {
    const result = await listRecoveryAudit()
    entries.value = result.entries
    loaded.value = true
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : '账号恢复记录读取失败'
  } finally {
    loading.value = false
  }
}

function toggle(): void {
  expanded.value = !expanded.value
  if (expanded.value && !loaded.value && !loading.value) void load()
}
</script>

<template>
  <section
    v-if="visible"
    class="settings-section recovery-audit"
    aria-labelledby="recovery-audit-heading"
  >
    <button
      type="button"
      class="recovery-audit__toggle"
      :aria-expanded="expanded"
      aria-controls="recovery-audit-content"
      @click="toggle"
    >
      <span>
        <small>仅房主可见</small>
        <strong id="recovery-audit-heading">账号恢复记录</strong>
      </span>
      <span class="recovery-audit__toggle-meta">
        <span class="recovery-audit__badge">
          <ShieldCheck :size="15" aria-hidden="true" />
          安全记录
        </span>
        <ChevronDown
          class="recovery-audit__chevron"
          :class="{ expanded }"
          :size="18"
          aria-hidden="true"
        />
      </span>
    </button>

    <Transition name="recovery-audit-expand">
      <div v-if="expanded" id="recovery-audit-content" class="recovery-audit__body">
        <p class="recovery-audit__intro">
          记录临时恢复码的生成和账号恢复结果，不保存任何恢复码、令牌或设备凭证。
        </p>

        <div v-if="loading" class="notification-loading">
          <LoaderCircle class="spin" :size="17" aria-hidden="true" />
          正在读取恢复记录
        </div>
        <p v-else-if="errorMessage" class="form-error">{{ errorMessage }}</p>
        <p v-else-if="entries.length === 0" class="recovery-audit__empty">
          暂无账号恢复记录。
        </p>
        <div v-else class="recovery-audit__list">
          <article v-for="entry in entries" :key="entry.id">
            <div>
              <strong>{{ eventLabel(entry) }}</strong>
              <time :datetime="entry.createdAt">{{ formatAuditTime(entry.createdAt) }}</time>
            </div>
            <p>
              目标：{{ entry.targetNickname }}
              <template v-if="entry.actorNickname">
                · 操作者：{{ entry.actorNickname }}
              </template>
            </p>
            <small v-if="entry.generatorNicknames.length">
              确认成员：{{ entry.generatorNicknames.join('、') }}
            </small>
          </article>
        </div>
      </div>
    </Transition>
  </section>
</template>
