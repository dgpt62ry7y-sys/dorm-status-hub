<script setup lang="ts">
import { Check } from '@lucide/vue'

defineProps<{
  message: string
  visible: boolean
}>()
</script>

<template>
  <Teleport to="body">
    <Transition name="toast">
      <div v-if="visible" class="app-toast" role="status" aria-live="polite">
        <Check :size="16" stroke-width="2.2" aria-hidden="true" />
        {{ message }}
      </div>
    </Transition>
  </Teleport>
</template>
