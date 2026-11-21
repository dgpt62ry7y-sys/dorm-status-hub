<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { LoaderCircle, ShieldCheck } from '@lucide/vue'
import { useDormStore } from '../composables/useDormStore'
import type { RecoveryAuditEntry } from '../types/dorm'

const { isOwner, listRecoveryAudit } = useDormStore()
const demoMode = __DEMO_MODE__
const entries = ref<RecoveryAuditEntry[]>([])
const loading = ref(false)
const errorMessage = ref('')

const visible = computed(() => isOwner.value && !demoMode)

function eventLabel(entry: RecoveryAuditEntry): string {
  if (entry.eventType === 'code_generated') {
    return entry.method === 'owner_assist'
      ? '生成房主临时恢复码'
      : '生成成员临时恢复码'
  }
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
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : '账号恢复记录读取失败'
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  void load()
})
</script>

<template>
  <section
    v-if="visible"
    class="settings-section recovery-audit"
    aria-labelledby="recovery-audit-heading"
  >
    <div class="settings-section__heading">
      <div>
        <p class="eyebrow">仅房主可见</p>
        <h2 id="recovery-audit-heading">账号恢复记录</h2>
      </div>
      <span class="recovery-audit__badge">
        <ShieldCheck :size="15" aria-hidden="true" />
        安全记录
      </span>
    </div>

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
  </section>
</template>
