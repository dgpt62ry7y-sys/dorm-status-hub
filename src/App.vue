<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { Home, Settings, Users } from 'lucide-vue-next'
import AccessGate from './components/AccessGate.vue'
import SecretCodeDialog from './components/SecretCodeDialog.vue'
import { useDormStore } from './composables/useDormStore'

const navItems = [
  { to: '/', label: '此刻', icon: Home },
  { to: '/members', label: '室友', icon: Users },
  { to: '/settings', label: '设置', icon: Settings },
]

const {
  state,
  phase,
  isOnline,
  isSyncing,
  secretDialog,
  initialize,
  dismissSecretDialog,
  confirmSecretDialog,
} = useDormStore()
const cloudLabel = computed(() => {
  if (phase.value !== 'ready') return 'CloudBase'
  if (!isOnline.value) return '离线'
  if (isSyncing.value) return '同步中'
  return state.room.name
})

onMounted(() => {
  void initialize()
})
</script>

<template>
  <div class="app-shell">
    <header class="site-header">
      <div class="site-header__inner">
        <RouterLink to="/" class="brand" aria-label="宿舍状态共享站首页">
          <span class="brand__mark" aria-hidden="true">
            <i></i>
            <i></i>
            <b></b>
          </span>
          <span>
            <strong>宿舍状态共享站</strong>
            <small>四人共享空间</small>
          </span>
        </RouterLink>

        <div class="site-header__right">
          <nav v-if="phase === 'ready'" class="desktop-nav" aria-label="主导航">
            <RouterLink v-for="item in navItems" :key="item.to" :to="item.to">
              <component :is="item.icon" :size="16" stroke-width="1.8" aria-hidden="true" />
              {{ item.label }}
            </RouterLink>
          </nav>
          <span
            class="demo-pill cloud-pill"
            :class="{ 'cloud-pill--offline': phase === 'ready' && !isOnline }"
          >
            <i aria-hidden="true"></i>
            {{ cloudLabel }}
          </span>
        </div>
      </div>
    </header>

    <main class="app-main" :class="{ 'app-main--gate': phase !== 'ready' }">
      <AccessGate v-if="phase !== 'ready'" />
      <RouterView v-else v-slot="{ Component, route }">
        <Transition name="page" mode="out-in">
          <component :is="Component" :key="route.path" />
        </Transition>
      </RouterView>
    </main>

    <nav v-if="phase === 'ready'" class="bottom-nav" aria-label="移动端主导航">
      <RouterLink v-for="item in navItems" :key="item.to" :to="item.to">
        <component :is="item.icon" :size="21" stroke-width="1.8" aria-hidden="true" />
        <span>{{ item.label }}</span>
      </RouterLink>
    </nav>

    <SecretCodeDialog
      v-if="secretDialog"
      :visible="Boolean(secretDialog)"
      :title="secretDialog.title"
      :description="secretDialog.description"
      :code="secretDialog.code"
      :required="secretDialog.required"
      @close="dismissSecretDialog"
      @confirm="confirmSecretDialog"
    />
  </div>
</template>
