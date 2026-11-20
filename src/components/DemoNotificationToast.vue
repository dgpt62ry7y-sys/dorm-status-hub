<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { BellRing } from '@lucide/vue'
import {
  DEMO_NOTIFICATION_EVENT,
  type DemoNotification,
} from '../demo/demoRuntime'

const notification = ref<DemoNotification | null>(null)
let hideTimer: number | undefined

function handleNotification(event: Event): void {
  notification.value = (event as CustomEvent<DemoNotification>).detail
  if (hideTimer) window.clearTimeout(hideTimer)
  hideTimer = window.setTimeout(() => {
    notification.value = null
  }, 6_000)
}

onMounted(() => {
  window.addEventListener(DEMO_NOTIFICATION_EVENT, handleNotification)
})

onBeforeUnmount(() => {
  window.removeEventListener(DEMO_NOTIFICATION_EVENT, handleNotification)
  if (hideTimer) window.clearTimeout(hideTimer)
})
</script>

<template>
  <Transition name="demo-notification">
    <aside v-if="notification" class="demo-notification-toast" aria-live="polite">
      <div class="demo-notification-toast__heading">
        <span>
          <BellRing :size="15" aria-hidden="true" />
          模拟手机通知
        </span>
        <small>
          <i v-for="channel in notification.channels" :key="channel">{{ channel }}</i>
        </small>
      </div>
      <strong>{{ notification.title }}</strong>
      <pre>{{ notification.body }}</pre>
    </aside>
  </Transition>
</template>
