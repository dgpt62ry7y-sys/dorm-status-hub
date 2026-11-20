<script setup lang="ts">
import { Check } from 'lucide-vue-next'
import StatusIcon from './StatusIcon.vue'
import { STATUS_OPTIONS, type DormStatus } from '../types/dorm'

defineProps<{
  activeStatus: DormStatus
}>()

const emit = defineEmits<{
  choose: [status: DormStatus]
}>()
</script>

<template>
  <div class="status-dial" aria-label="选择我的状态">
    <button
      v-for="(option, index) in STATUS_OPTIONS"
      :key="option.value"
      type="button"
      class="status-tile"
      :class="{ 'status-tile--active': activeStatus === option.value }"
      :style="{
        '--status-tone': option.tone,
        '--status-soft': option.softTone,
        '--action-index': index,
      }"
      :aria-label="`${option.label}：${option.description}`"
      @click="emit('choose', option.value)"
    >
      <span class="status-tile__icon">
        <StatusIcon :status="option.value" :size="21" />
      </span>
      <strong>{{ option.label }}</strong>
      <Check
        v-if="activeStatus === option.value"
        :size="14"
        stroke-width="2"
        aria-label="当前状态"
      />
    </button>
  </div>
</template>
