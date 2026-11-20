<script setup lang="ts">
import { computed } from 'vue'
import { PencilLine } from '@lucide/vue'
import StatusIcon from './StatusIcon.vue'
import {
  getStatusOption,
  isQuietStatus,
  type Member,
  type StatusRecord,
} from '../types/dorm'
import { formatRelativeTime, statusSummary } from '../utils/time'

const props = defineProps<{
  member: Member
  record: StatusRecord
  now: Date
  mine?: boolean
}>()

const emit = defineEmits<{
  edit: []
}>()

const option = computed(() => getStatusOption(props.record.status))
const summary = computed(() => statusSummary(props.record))
const summaryParts = computed(() =>
  summary.value
    .split(/(\d{2}:\d{2})/g)
    .filter(Boolean)
    .map((text) => ({
      text,
      isTime: /^\d{2}:\d{2}$/.test(text),
    })),
)
const initial = computed(() => Array.from(props.member.nickname)[0] ?? '友')
const isQuiet = computed(() => isQuietStatus(props.record.status))
</script>

<template>
  <article
    class="roster-item"
    :class="{ 'roster-item--mine': mine }"
    :style="{ '--status-tone': option.tone, '--status-soft': option.softTone }"
  >
    <div class="roster-item__person">
      <span class="avatar roster-item__avatar" aria-hidden="true">{{ initial }}</span>
      <div class="roster-item__identity">
        <span>
          <strong>{{ member.nickname }}</strong>
          <i v-if="mine">你</i>
        </span>
        <small>{{ member.role === 'owner' ? '宿舍创建者' : '室友' }}</small>
      </div>
    </div>

    <div class="roster-item__status">
      <span class="roster-item__label">
        <i
          class="roster-item__dot"
          :class="{ 'roster-item__dot--quiet': isQuiet }"
          aria-hidden="true"
        ></i>
        <StatusIcon :status="record.status" :size="17" />
        {{ option.label }}
      </span>
      <p>
        <span
          v-for="(part, partIndex) in summaryParts"
          :key="`${part.text}-${partIndex}`"
          :class="{ 'roster-item__time': part.isTime }"
        >{{ part.text }}</span>
      </p>
      <small v-if="record.note && record.note !== summary">{{ record.note }}</small>
    </div>

    <div class="roster-item__meta">
      <span>{{ formatRelativeTime(record.updatedAt, now) }}</span>
      <button v-if="mine" type="button" class="roster-edit" @click="emit('edit')">
        <PencilLine :size="14" stroke-width="1.8" aria-hidden="true" />
        修改
      </button>
      <small v-else>{{ option.description }}</small>
    </div>
  </article>
</template>
