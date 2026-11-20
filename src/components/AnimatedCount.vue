<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'

const props = defineProps<{
  value: number
}>()

const displayed = ref(props.value)
let frame = 0

function animateTo(target: number): void {
  cancelAnimationFrame(frame)
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (reduceMotion) {
    displayed.value = target
    return
  }

  const startValue = displayed.value
  const startedAt = performance.now()
  const duration = 320

  const tick = (now: number) => {
    const progress = Math.min(1, (now - startedAt) / duration)
    const eased = 1 - Math.pow(1 - progress, 3)
    displayed.value = Math.round(startValue + (target - startValue) * eased)
    if (progress < 1) frame = requestAnimationFrame(tick)
  }

  frame = requestAnimationFrame(tick)
}

watch(
  () => props.value,
  (value) => animateTo(value),
)

onBeforeUnmount(() => cancelAnimationFrame(frame))
</script>

<template>
  <span>{{ displayed }}</span>
</template>
