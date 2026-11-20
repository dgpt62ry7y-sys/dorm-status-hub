export type DormStatus = 'sleep' | 'normal' | 'focus' | 'away'
export type RoomCapacity = 4 | 6

export interface CapacityNotice {
  id: string
  from: RoomCapacity
  to: RoomCapacity
  changedAt: string
  changedBy: string
}

export interface ReleaseNotice {
  id: string
  fromVersion: string
  toVersion: string
  items: string[]
}

export interface RoomVerification {
  required: boolean
  isOwner: boolean
  promptedAt: string | null
  deadlineAt: string | null
  fallbackAt: string
}

export interface Member {
  id: string
  nickname: string
  role: 'owner' | 'member'
  joinedAt: string
}

export interface StatusRecord {
  memberId: string
  status: DormStatus
  note: string
  updatedAt: string
  endAt: string | null
}

export interface DormState {
  room: {
    id: string
    name: string
    inviteCode: string
    ownerId: string
    capacity: RoomCapacity
    memberCount?: number
    notificationTopicUpdatedAt?: string | null
    notificationTopicNeedsRotation?: boolean
  }
  members: Member[]
  statuses: StatusRecord[]
  currentMemberId: string
  currentDeviceId: string
  serverVersion: string
  roomVerification?: RoomVerification | null
  capacityNotice?: CapacityNotice | null
  releaseNotice?: ReleaseNotice | null
  notificationWarning?: string | null
  preferences: {
    defaultStatus: DormStatus
  }
}

export interface StatusUpdate {
  status: DormStatus
  note: string
  endAt: string | null
}

export interface DeviceSession {
  id: string
  label: string
  createdAt: string
  lastSeenAt: string
  isCurrent: boolean
}

export interface DeviceListResult {
  currentDeviceId: string
  devices: DeviceSession[]
}

export interface DeviceLinkResult {
  code: string
  expiresAt: string
}

export interface NotificationSettings {
  serverUrl: string
  topic: string
  topicUpdatedAt: string | null
  topicNeedsRotation: boolean
  isOwner: boolean
  roomName: string
  androidDeepLink: string
  installUrl: string
}

export interface BarkDevice {
  id: string
  label: string
  maskedKey: string
  createdAt: string
  updatedAt: string
  lastSuccessAt: string | null
}

export interface BarkDeviceListResult {
  devices: BarkDevice[]
  configured: boolean
  installUrl: string
}

export interface RevokeDeviceResult extends DeviceListResult {
  revokedCurrent: boolean
}

export interface StatusOption {
  value: DormStatus
  label: string
  description: string
  tone: string
  softTone: string
}

export const STATUS_OPTIONS: StatusOption[] = [
  {
    value: 'sleep',
    label: '睡觉中',
    description: '保持安静，减少打扰',
    tone: '#6557d2',
    softTone: '#ece9ff',
  },
  {
    value: 'normal',
    label: '正常活动',
    description: '可以正常交流',
    tone: '#17875a',
    softTone: '#ddf5e9',
  },
  {
    value: 'focus',
    label: '专注学习',
    description: '尽量减少打扰',
    tone: '#2f67d8',
    softTone: '#e4edff',
  },
  {
    value: 'away',
    label: '外出',
    description: '当前不在宿舍',
    tone: '#8b5b3f',
    softTone: '#f3e8df',
  },
]

export const getStatusOption = (status: DormStatus): StatusOption =>
  STATUS_OPTIONS.find((option) => option.value === status) ?? STATUS_OPTIONS[2]

export const isTimedStatus = (status: DormStatus): boolean =>
  status === 'sleep' || status === 'focus' || status === 'away'

export const isQuietStatus = (status: DormStatus): boolean =>
  status === 'sleep' || status === 'focus'
