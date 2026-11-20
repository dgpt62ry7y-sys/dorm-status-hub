<script setup lang="ts">
import { computed, type Component } from 'vue'
import { BookOpen, Circle, DoorOpen, Moon } from 'lucide-vue-next'
import type { DormStatus } from '../types/dorm'

const props = withDefaults(
  defineProps<{
    status: DormStatus
    size?: number
    strokeWidth?: number
  }>(),
  {
    size: 18,
    strokeWidth: 1.8,
  },
)

const icons: Record<DormStatus, Component> = {
  sleep: Moon,
  normal: Circle,
  focus: BookOpen,
  away: DoorOpen,
}

const icon = computed(() => icons[props.status])
</script>

<template>
  <component
    :is="icon"
    :size="size"
    :stroke-width="strokeWidth"
    aria-hidden="true"
    class="status-icon"
  />
</template>
