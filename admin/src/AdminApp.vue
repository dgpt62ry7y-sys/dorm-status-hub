<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  DoorOpen,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  Search,
  ShieldCheck,
} from 'lucide-vue-next'

interface AdminRoom {
  id: string
  name: string
  ownerNickname: string
  memberCount: number
  capacity: number
  createdAt: string | null
  lastActiveAt: string | null
  verificationStatus: 'verified' | 'pending'
  verificationPromptedAt: string | null
  verificationDeadlineAt: string | null
  verificationFallbackAt: string | null
  closed: boolean
}

const apiUrl = import.meta.env.VITE_DORMSYNC_API_URL
const storedKey = sessionStorage.getItem('dormsync:admin-key') || ''
const adminKey = ref(storedKey)
const rooms = ref<AdminRoom[]>([])
const loading = ref(false)
const errorMessage = ref('')
const query = ref('')

const filteredRooms = computed(() => {
  const keyword = query.value.trim().toLowerCase()
  if (!keyword) return rooms.value
  return rooms.value.filter(
    (room) =>
      room.name.toLowerCase().includes(keyword) ||
      room.ownerNickname.toLowerCase().includes(keyword) ||
      room.id.toLowerCase().includes(keyword),
  )
})

const pendingCount = computed(
  () => rooms.value.filter((room) => room.verificationStatus === 'pending').length,
)

function formatTime(value: string | null): string {
  if (!value) return '暂无'
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return '暂无'
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

async function loadRooms(): Promise<void> {
  if (!adminKey.value.trim()) {
    errorMessage.value = '请输入管理密钥'
    return
  }

  loading.value = true
  errorMessage.value = ''
  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'adminListRooms',
        adminKey: adminKey.value,
      }),
    })
    const result = await response.json()
    if (!result.ok) throw new Error(result.error.message)
    rooms.value = result.data.rooms
    sessionStorage.setItem('dormsync:admin-key', adminKey.value)
  } catch (error) {
    rooms.value = []
    errorMessage.value = error instanceof Error ? error.message : '读取失败'
  } finally {
    loading.value = false
  }
}

function logout(): void {
  sessionStorage.removeItem('dormsync:admin-key')
  adminKey.value = ''
  rooms.value = []
  errorMessage.value = ''
}

onMounted(() => {
  if (storedKey) void loadRooms()
})
</script>

<template>
  <main class="admin-shell">
    <header class="admin-header">
      <div>
        <p class="admin-eyebrow">LOCAL ADMIN / READ ONLY</p>
        <h1>寝室管理台</h1>
        <p>仅在本机运行，只读取正式环境的寝室级状态。</p>
      </div>
      <span class="admin-secure">
        <ShieldCheck :size="17" aria-hidden="true" />
        本地只读
      </span>
    </header>

    <section class="admin-gate">
      <label>
        <span>管理密钥</span>
        <input
          v-model="adminKey"
          type="password"
          autocomplete="off"
          placeholder="仅保存在当前标签页"
          @keyup.enter="loadRooms"
        />
      </label>
      <button type="button" :disabled="loading" @click="loadRooms">
        <LoaderCircle v-if="loading" class="spin" :size="17" aria-hidden="true" />
        <LockKeyhole v-else :size="17" aria-hidden="true" />
        {{ loading ? '正在读取…' : '进入管理台' }}
      </button>
      <button v-if="rooms.length" type="button" class="admin-logout" @click="logout">
        锁定并清除
      </button>
    </section>

    <p v-if="errorMessage" class="admin-error">{{ errorMessage }}</p>

    <template v-if="rooms.length">
      <section class="admin-summary">
        <div>
          <span>寝室总数</span>
          <strong>{{ rooms.length }}</strong>
        </div>
        <div>
          <span>待验证</span>
          <strong>{{ pendingCount }}</strong>
        </div>
        <div>
          <span>当前筛选</span>
          <strong>{{ filteredRooms.length }}</strong>
        </div>
        <button type="button" :disabled="loading" @click="loadRooms">
          <RefreshCw :class="{ spin: loading }" :size="16" aria-hidden="true" />
          刷新
        </button>
      </section>

      <label class="admin-search">
        <Search :size="16" aria-hidden="true" />
        <input v-model="query" type="search" placeholder="查找寝室名称、房主或 ID" />
      </label>

      <div class="admin-table-wrap">
        <table>
          <thead>
            <tr>
              <th>寝室</th>
              <th>房主</th>
              <th>成员</th>
              <th>房型</th>
              <th>验证</th>
              <th>最近活动</th>
              <th>创建时间</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="room in filteredRooms" :key="room.id">
              <td>
                <strong>{{ room.name }}</strong>
                <small>{{ room.id }}</small>
              </td>
              <td>{{ room.ownerNickname || '暂无' }}</td>
              <td>{{ room.memberCount }}</td>
              <td>{{ room.capacity }} 人寝</td>
              <td>
                <span
                  class="admin-status"
                  :class="{
                    'admin-status--verified': room.verificationStatus === 'verified',
                    'admin-status--pending': room.verificationStatus === 'pending',
                  }"
                >
                  {{ room.closed ? '已关闭' : room.verificationStatus === 'verified' ? '已验证' : '待验证' }}
                </span>
                <small v-if="room.verificationStatus === 'pending'">
                  截止 {{ formatTime(room.verificationDeadlineAt) }}
                </small>
              </td>
              <td>{{ formatTime(room.lastActiveAt) }}</td>
              <td>{{ formatTime(room.createdAt) }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <p v-if="filteredRooms.length === 0" class="admin-empty">
        <DoorOpen :size="18" aria-hidden="true" />
        没有匹配的寝室
      </p>
    </template>
  </main>
</template>
