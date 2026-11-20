<script setup lang="ts">
import { computed } from 'vue'
import { Moon, VolumeX } from 'lucide-vue-next'
import AnimatedCount from './AnimatedCount.vue'
import { getEffectiveStatus, formatClock } from '../utils/time'
import { isQuietStatus, type StatusRecord } from '../types/dorm'

const props = defineProps<{
  statuses: StatusRecord[]
  now: Date
}>()

const quietRecords = computed(() =>
  props.statuses
    .map((record) => getEffectiveStatus(record, props.now))
    .filter((record) => isQuietStatus(record.status)),
)

const hasQuiet = computed(() => quietRecords.value.length > 0)
const quietLevel = computed(() => Math.min(6, quietRecords.value.length))
const hasUnknownEnd = computed(() => quietRecords.value.some((record) => !record.endAt))
const latestEnd = computed(() => {
  const timestamps = quietRecords.value
    .map((record) => (record.endAt ? new Date(record.endAt).getTime() : 0))
    .filter((timestamp) => timestamp > 0)
  return timestamps.length > 0 ? new Date(Math.max(...timestamps)) : null
})
</script>

<template>
  <section
    class="quiet-banner"
    :class="[
      `quiet-banner--count-${quietLevel}`,
      { 'quiet-banner--clear': !hasQuiet },
    ]"
    aria-live="polite"
    aria-atomic="true"
  >
    <div class="quiet-banner__icon" aria-hidden="true">
      <VolumeX v-if="hasQuiet" :size="24" stroke-width="1.7" />
      <Moon v-else :size="24" stroke-width="1.7" />
    </div>

    <div class="quiet-banner__copy">
      <p class="quiet-banner__eyebrow">{{ hasQuiet ? '安静提醒' : '宿舍状态' }}</p>
      <h2>{{ hasQuiet ? '现在请保持安静' : '此刻可以正常交流' }}</h2>
      <p v-if="hasQuiet">
        {{ quietRecords.length }} 人正在休息
        <span aria-hidden="true">·</span>
        {{
          hasUnknownEnd
            ? '安静结束时间暂未确定'
            : `预计最晚 ${formatClock(latestEnd)} 结束`
        }}
      </p>
      <p v-else>现在没有人处于睡眠状态。</p>
    </div>

    <div v-if="hasQuiet" class="quiet-banner__count" aria-label="安静人数">
      <AnimatedCount :value="quietRecords.length" />
      <small>人休息</small>
    </div>
  </section>
</template>
