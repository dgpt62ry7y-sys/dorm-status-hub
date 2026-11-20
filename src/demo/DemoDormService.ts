import { APP_VERSION } from '../../version.config'
import type {
  BarkDevice,
  BarkDeviceListResult,
  DeviceListResult,
  DeviceLinkResult,
  DormState,
  DormStatus,
  Member,
  NotificationSettings,
  RoomCapacity,
  StatusRecord,
} from '../types/dorm'

export const DEMO_NOTIFICATION_EVENT = 'dormsync:demo-notification'
export const DEMO_ROOM_ID = 'demo-room-433'

export interface DemoNotification {
  id: string
  title: string
  body: string
  channels: Array<'ntfy' | 'bark'>
  createdAt: string
}

export interface DemoAccount {
  memberId: string
  nickname: string
  memberToken: string
  role: Member['role']
}

interface DemoSession {
  id: string
  label: string
  createdAt: string
  lastSeenAt: string
}

interface DemoMemberRecord extends Member {
  roomId: string
  active: boolean
  defaultStatus: DormStatus
  memberToken: string
  sessions: DemoSession[]
}

interface DemoBarkRecord extends BarkDevice {
  memberId: string
}

class DemoApiError extends Error {
  code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'DemoApiError'
    this.code = code
  }
}

const VALID_STATUSES = new Set<DormStatus>(['sleep', 'normal', 'focus', 'away'])
const REQUIRED_TIME_STATUSES = new Set<DormStatus>(['sleep', 'away'])
const TIMED_STATUSES = new Set<DormStatus>(['sleep', 'focus', 'away'])

function nowIso(): string {
  return new Date().toISOString()
}

function createInviteCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  return Array.from({ length: 6 }, () =>
    alphabet[crypto.getRandomValues(new Uint32Array(1))[0] % alphabet.length],
  ).join('')
}

function cleanText(value: unknown, maxLength: number): string {
  return String(value ?? '').trim().slice(0, maxLength)
}

function notificationSafeText(value: unknown): string {
  return String(value ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function beijingParts(value: Date): Record<string, string> {
  return Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      hourCycle: 'h23',
    })
      .formatToParts(value)
      .map((part) => [part.type, part.value]),
  )
}

function notificationTime(value: string, reference: string): string {
  const target = new Date(value)
  const ref = new Date(reference)
  if (!Number.isFinite(target.getTime()) || !Number.isFinite(ref.getTime())) return ''
  const targetParts = beijingParts(target)
  const referenceParts = beijingParts(ref)
  const targetDate = Date.UTC(
    Number(targetParts.year),
    Number(targetParts.month) - 1,
    Number(targetParts.day),
  )
  const referenceDate = Date.UTC(
    Number(referenceParts.year),
    Number(referenceParts.month) - 1,
    Number(referenceParts.day),
  )
  const difference = Math.round((targetDate - referenceDate) / 86_400_000)
  const clock = `${targetParts.hour}:${targetParts.minute}`
  if (difference === 0) return clock
  if (difference === 1) return `明天 ${clock}`
  return `${Number(targetParts.month)}月${Number(targetParts.day)}日 ${clock}`
}

function tomorrowAt(hour: number, minute: number): string {
  const parts = beijingParts(new Date())
  const today = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day))
  const tomorrow = new Date(today + 86_400_000).toISOString().slice(0, 10)
  return new Date(
    `${tomorrow}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+08:00`,
  ).toISOString()
}

function buildNotificationBody(
  member: DemoMemberRecord,
  status: StatusRecord,
  quietCount: number,
  capacity: number,
): string {
  const nickname = notificationSafeText(member.nickname) || '室友'
  const lines: string[] = []
  if (status.status === 'sleep') lines.push(`💤 ${nickname} 正在睡觉`)
  else if (status.status === 'focus') lines.push(`📚 ${nickname} 正在专注学习`)
  else if (status.status === 'away') lines.push(`🚶 ${nickname} 已外出`)
  else lines.push(`🏠 ${nickname} 已恢复正常活动`)

  if (status.endAt) {
    const time = notificationTime(status.endAt, status.updatedAt)
    if (status.status === 'sleep' && time) lines.push(`⏰ 预计起床：${time}`)
    if (status.status === 'focus' && time) lines.push(`⏰ 预计结束：${time}`)
    if (status.status === 'away' && time) lines.push(`🏠 预计回寝：${time}`)
  }
  if (status.status === 'normal') {
    lines.push(`🕒 更新时间：${notificationTime(status.updatedAt, status.updatedAt)}`)
  }
  const note = notificationSafeText(status.note)
  if (note) lines.push(`💬 留言：${note}`)
  if (status.status === 'sleep' || status.status === 'focus') {
    lines.push(`🤫 安静人数：${quietCount} / ${capacity}，请尽量保持安静。`)
  }
  return lines.join('\n')
}

export class DemoDormService {
  private members: DemoMemberRecord[] = []
  private statuses: StatusRecord[] = []
  private barkDevices: DemoBarkRecord[] = []
  private notifications: DemoNotification[] = []
  private room = {
    name: '体验六人寝',
    inviteCode: 'DEMO66',
    ownerId: 'demo-member-1',
    capacity: 6 as RoomCapacity,
    topic: 'dormsync-demo-room',
    topicUpdatedAt: nowIso(),
  }

  constructor() {
    this.reset()
  }

  reset(): void {
    const joinedAt = new Date(Date.now() - 30 * 86_400_000).toISOString()
    const recent = new Date(Date.now() - 5 * 60_000).toISOString()
    const names = ['林一', '周宁', '陈星', '许言', '唐可', '江禾']
    this.members = names.map((nickname, index) => ({
      id: `demo-member-${index + 1}`,
      roomId: DEMO_ROOM_ID,
      nickname,
      role: index === 0 ? 'owner' : 'member',
      joinedAt,
      active: true,
      defaultStatus: 'normal',
      memberToken: `demo-token-${index + 1}`,
      sessions: [
        {
          id: `demo-session-${index + 1}`,
          label: index === 0 ? '当前浏览器' : `${nickname}的演示设备`,
          createdAt: joinedAt,
          lastSeenAt: recent,
        },
      ],
    }))
    this.statuses = [
      {
        memberId: 'demo-member-1',
        status: 'normal',
        note: '刚回到宿舍',
        endAt: null,
        updatedAt: recent,
      },
      {
        memberId: 'demo-member-2',
        status: 'sleep',
        note: '晚安',
        endAt: tomorrowAt(7, 30),
        updatedAt: recent,
      },
      {
        memberId: 'demo-member-3',
        status: 'focus',
        note: '准备考试',
        endAt: new Date(Date.now() + 2 * 3_600_000).toISOString(),
        updatedAt: recent,
      },
      {
        memberId: 'demo-member-4',
        status: 'away',
        note: '去实验室',
        endAt: new Date(Date.now() + 3 * 3_600_000).toISOString(),
        updatedAt: recent,
      },
      {
        memberId: 'demo-member-5',
        status: 'normal',
        note: '可以正常交流',
        endAt: null,
        updatedAt: recent,
      },
      {
        memberId: 'demo-member-6',
        status: 'normal',
        note: '',
        endAt: null,
        updatedAt: recent,
      },
    ]
    this.barkDevices = this.members.map((member, index) => ({
      id: `demo-bark-${index + 1}`,
      memberId: member.id,
      label: index === 0 ? '体验 iPhone' : `${member.nickname}的 iPhone`,
      maskedKey: `••••D${index + 1}MO`,
      createdAt: joinedAt,
      updatedAt: recent,
      lastSuccessAt: recent,
    }))
    this.notifications = []
    this.seedInitialNotifications()
  }

  getAccounts(): DemoAccount[] {
    return this.members
      .filter((member) => member.active)
      .map((member) => ({
        memberId: member.id,
        nickname: member.nickname,
        memberToken: member.memberToken,
        role: member.role,
      }))
  }

  getFirstToken(): string {
    return this.getAccounts()[0]?.memberToken || ''
  }

  getNotifications(): DemoNotification[] {
    return this.notifications.map((notification) => ({ ...notification }))
  }

  clearNotifications(): void {
    this.notifications = []
  }

  dispatch(action: string, payload: Record<string, unknown>): unknown {
    if (action === 'getState') {
      const member = this.requireMember(payload.memberToken)
      return this.buildState(member)
    }
    if (action === 'updateStatus') {
      return this.updateStatus(payload)
    }
    if (action === 'updateProfile') {
      return this.updateProfile(payload)
    }
    if (action === 'regenerateInvite') {
      return this.regenerateInvite(payload)
    }
    if (action === 'removeMember') {
      return this.removeMember(payload)
    }
    if (action === 'leaveRoom') {
      return this.leaveRoom(payload)
    }
    if (action === 'createDeviceLink') {
      return this.createDeviceLink(payload)
    }
    if (action === 'listDevices') {
      return this.listDevices(payload)
    }
    if (action === 'revokeDevice') {
      return this.revokeDevice(payload)
    }
    if (action === 'rotateRecoveryCode') {
      return { recoveryCode: createInviteCode() + createInviteCode() + createInviteCode() }
    }
    if (action === 'updateRoomCapacity') {
      return this.updateRoomCapacity(payload)
    }
    if (action === 'acknowledgeCapacityNotice' || action === 'acknowledgeReleaseNotice') {
      return { acknowledged: true }
    }
    if (action === 'verifyExistingRoom') {
      return this.buildState(this.requireMember(payload.memberToken))
    }
    if (action === 'getNotificationSettings') {
      return this.getNotificationSettings(payload)
    }
    if (action === 'rotateNotificationTopic') {
      this.room.topic = `dormsync-demo-${crypto.randomUUID().slice(0, 12)}`
      this.room.topicUpdatedAt = nowIso()
      return this.getNotificationSettings(payload)
    }
    if (action === 'sendTestNotification') {
      return this.sendTestNotification(payload)
    }
    if (action === 'listBarkDevices') {
      return this.listBarkDevices(payload)
    }
    if (action === 'testBarkNotification') {
      return this.testBarkNotification(payload)
    }
    if (action === 'registerBarkDevice') {
      return this.registerBarkDevice(payload)
    }
    if (action === 'removeBarkDevice') {
      return this.removeBarkDevice(payload)
    }
    throw new DemoApiError('DEMO_ACTION_UNAVAILABLE', '该操作在体验版中不可用')
  }

  private seedInitialNotifications(): void {
    const sleepMember = this.members.find((member) => member.id === 'demo-member-2')
    const focusMember = this.members.find((member) => member.id === 'demo-member-3')
    const sleep = this.statuses.find((status) => status.memberId === sleepMember?.id)
    const focus = this.statuses.find((status) => status.memberId === focusMember?.id)
    const quietCount = this.statuses.filter(
      (status) => status.status === 'sleep' || status.status === 'focus',
    ).length
    if (sleepMember && sleep) {
      this.notifications.push({
        id: crypto.randomUUID(),
        title: 'DormSync · 宿舍状态更新',
        body: buildNotificationBody(sleepMember, sleep, quietCount, 6),
        channels: ['ntfy', 'bark'],
        createdAt: sleep.updatedAt,
      })
    }
    if (focusMember && focus) {
      this.notifications.unshift({
        id: crypto.randomUUID(),
        title: 'DormSync · 宿舍状态更新',
        body: buildNotificationBody(focusMember, focus, quietCount, 6),
        channels: ['ntfy', 'bark'],
        createdAt: focus.updatedAt,
      })
    }
  }

  private requireMember(token: unknown): DemoMemberRecord {
    const member = this.members.find(
      (item) => item.active && item.memberToken === String(token || ''),
    )
    if (!member) throw new DemoApiError('AUTH_REQUIRED', '体验账号已失效')
    return member
  }

  private activeMembers(): DemoMemberRecord[] {
    return this.members.filter((member) => member.active)
  }

  private expireStatuses(): void {
    const now = Date.now()
    for (const status of this.statuses) {
      if (
        TIMED_STATUSES.has(status.status) &&
        status.endAt &&
        Date.parse(status.endAt) <= now
      ) {
        status.status = 'normal'
        status.note = ''
        status.endAt = null
        status.updatedAt = nowIso()
      }
    }
  }

  private buildState(member: DemoMemberRecord): DormState {
    this.expireStatuses()
    const activeIds = new Set(this.activeMembers().map((item) => item.id))
    return {
      room: {
        id: DEMO_ROOM_ID,
        name: this.room.name,
        inviteCode: this.room.inviteCode,
        ownerId: this.room.ownerId,
        capacity: this.room.capacity,
        memberCount: activeIds.size,
        notificationTopicUpdatedAt: this.room.topicUpdatedAt,
        notificationTopicNeedsRotation: false,
      },
      currentMemberId: member.id,
      currentDeviceId: member.sessions[0]?.id || '',
      serverVersion: APP_VERSION,
      roomVerification: null,
      members: this.activeMembers().map((item) => ({
        id: item.id,
        nickname: item.nickname,
        role: item.role,
        joinedAt: item.joinedAt,
      })),
      statuses: this.statuses
        .filter((status) => activeIds.has(status.memberId))
        .map((status) => ({ ...status })),
      preferences: {
        defaultStatus: member.defaultStatus,
      },
    }
  }

  private updateStatus(payload: Record<string, unknown>): DormState {
    const member = this.requireMember(payload.memberToken)
    const status = String(payload.status || '') as DormStatus
    if (!VALID_STATUSES.has(status)) {
      throw new DemoApiError('INVALID_STATUS', '状态无效')
    }
    if (REQUIRED_TIME_STATUSES.has(status) && !payload.endAt) {
      throw new DemoApiError(
        'END_TIME_REQUIRED',
        status === 'away' ? '外出需要设置预计回寝时间' : '睡觉中需要设置预计起床时间',
      )
    }
    let endAt: string | null = null
    if (TIMED_STATUSES.has(status) && payload.endAt) {
      const parsed = Date.parse(String(payload.endAt))
      if (!Number.isFinite(parsed) || parsed <= Date.now()) {
        throw new DemoApiError('INVALID_END_TIME', '预计结束时间必须晚于现在')
      }
      endAt = new Date(parsed).toISOString()
    }
    const note = cleanText(payload.note, 30)
    const current = this.statuses.find((item) => item.memberId === member.id)
    const changed =
      !current ||
      current.status !== status ||
      current.note !== note ||
      current.endAt !== endAt
    const next: StatusRecord = {
      memberId: member.id,
      status,
      note,
      endAt,
      updatedAt: nowIso(),
    }
    if (current) Object.assign(current, next)
    else this.statuses.push(next)
    this.expireStatuses()
    const state = this.buildState(member)
    if (changed) {
      const quietCount = state.statuses.filter(
        (item) => item.status === 'sleep' || item.status === 'focus',
      ).length
      this.addNotification({
        title: 'DormSync · 宿舍状态更新',
        body: buildNotificationBody(member, next, quietCount, state.room.capacity),
        channels: ['ntfy', 'bark'],
      })
    }
    return state
  }

  private updateProfile(payload: Record<string, unknown>): DormState {
    const member = this.requireMember(payload.memberToken)
    const nickname = cleanText(payload.nickname, 12)
    if (!nickname) throw new DemoApiError('NICKNAME_REQUIRED', '请输入昵称')
    if (
      this.activeMembers().some(
        (item) => item.id !== member.id && item.nickname === nickname,
      )
    ) {
      throw new DemoApiError('NICKNAME_TAKEN', '这个昵称已经被使用')
    }
    member.nickname = nickname
    if (VALID_STATUSES.has(payload.defaultStatus as DormStatus)) {
      member.defaultStatus = payload.defaultStatus as DormStatus
    }
    return this.buildState(member)
  }

  private regenerateInvite(payload: Record<string, unknown>): { inviteCode: string; state: DormState } {
    const member = this.requireMember(payload.memberToken)
    if (member.role !== 'owner') {
      throw new DemoApiError('ONLY_OWNER', '只有宿舍创建者可以重新生成邀请码')
    }
    this.room.inviteCode = createInviteCode()
    return { inviteCode: this.room.inviteCode, state: this.buildState(member) }
  }

  private removeMember(payload: Record<string, unknown>): DormState {
    const member = this.requireMember(payload.memberToken)
    if (member.role !== 'owner') {
      throw new DemoApiError('ONLY_OWNER', '只有宿舍创建者可以移除成员')
    }
    const target = this.members.find(
      (item) => item.id === String(payload.memberId || '') && item.active,
    )
    if (!target || target.role === 'owner') {
      throw new DemoApiError('INVALID_MEMBER', '成员不存在或不能移除')
    }
    target.active = false
    this.barkDevices = this.barkDevices.filter((device) => device.memberId !== target.id)
    const status = this.statuses.find((item) => item.memberId === target.id)
    if (status) {
      status.status = 'normal'
      status.note = ''
      status.endAt = null
      status.updatedAt = nowIso()
    }
    return this.buildState(member)
  }

  private leaveRoom(payload: Record<string, unknown>): { left: true } {
    const member = this.requireMember(payload.memberToken)
    member.active = false
    if (member.role === 'owner') {
      const next = this.activeMembers()[0]
      if (next) {
        next.role = 'owner'
        this.room.ownerId = next.id
      }
    }
    this.barkDevices = this.barkDevices.filter((device) => device.memberId !== member.id)
    return { left: true }
  }

  private createDeviceLink(payload: Record<string, unknown>): DeviceLinkResult {
    this.requireMember(payload.memberToken)
    return {
      code: createInviteCode().slice(0, 5) + '123',
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    }
  }

  private listDevices(payload: Record<string, unknown>): DeviceListResult {
    const member = this.requireMember(payload.memberToken)
    return {
      currentDeviceId: member.sessions[0]?.id || '',
      devices: member.sessions.map((session) => ({
        id: session.id,
        label: session.label,
        createdAt: session.createdAt,
        lastSeenAt: session.lastSeenAt,
        isCurrent: session.id === member.sessions[0]?.id,
      })),
    }
  }

  private revokeDevice(payload: Record<string, unknown>) {
    const member = this.requireMember(payload.memberToken)
    const deviceId = cleanText(payload.deviceId, 100)
    const isCurrent = member.sessions[0]?.id === deviceId
    member.sessions = member.sessions.filter((session) => session.id !== deviceId)
    return {
      currentDeviceId: member.sessions[0]?.id || '',
      revokedCurrent: isCurrent,
      devices: member.sessions.map((session) => ({
        id: session.id,
        label: session.label,
        createdAt: session.createdAt,
        lastSeenAt: session.lastSeenAt,
        isCurrent: session.id === member.sessions[0]?.id,
      })),
    }
  }

  private updateRoomCapacity(payload: Record<string, unknown>): DormState {
    const member = this.requireMember(payload.memberToken)
    if (member.role !== 'owner') {
      throw new DemoApiError('ONLY_OWNER', '只有宿舍创建者可以修改房型')
    }
    const capacity = Number(payload.capacity)
    if (![4, 6].includes(capacity)) {
      throw new DemoApiError('INVALID_CAPACITY', '宿舍容量只能是四人寝或六人寝')
    }
    if (capacity === 4 && this.activeMembers().length > 4) {
      throw new DemoApiError('CAPACITY_LIMIT', '请先将当前成员移除到 4 人或更少')
    }
    this.room.capacity = capacity as RoomCapacity
    return this.buildState(member)
  }

  private getNotificationSettings(payload: Record<string, unknown>): NotificationSettings {
    const member = this.requireMember(payload.memberToken)
    return {
      serverUrl: 'https://ntfy.sh',
      topic: this.room.topic,
      topicUpdatedAt: this.room.topicUpdatedAt,
      topicNeedsRotation: false,
      isOwner: member.role === 'owner',
      roomName: this.room.name,
      androidDeepLink: '',
      installUrl: 'https://docs.ntfy.sh/subscribe/phone/',
    }
  }

  private sendTestNotification(payload: Record<string, unknown>) {
    const member = this.requireMember(payload.memberToken)
    if (member.role !== 'owner') {
      throw new DemoApiError('ONLY_OWNER', '只有房主可以发送测试通知')
    }
    const sentAt = nowIso()
    this.addNotification({
      title: 'DormSync · 模拟通知测试',
      body: [
        '🔔 这是一条体验版模拟通知',
        `🏠 宿舍：${this.room.name}`,
        `👤 发送者：${member.nickname}`,
      ].join('\n'),
      channels: ['ntfy', 'bark'],
      createdAt: sentAt,
    })
    return { sent: true, sentAt }
  }

  private listBarkDevices(payload: Record<string, unknown>): BarkDeviceListResult {
    const member = this.requireMember(payload.memberToken)
    return {
      devices: this.barkDevices
        .filter((device) => device.memberId === member.id)
        .map(({ memberId: _memberId, ...device }) => device),
      configured: true,
      installUrl: 'https://apps.apple.com/app/id1403753865',
    }
  }

  private testBarkNotification(payload: Record<string, unknown>) {
    const member = this.requireMember(payload.memberToken)
    const device = this.barkDevices.find(
      (item) =>
        item.id === String(payload.deviceId || '') && item.memberId === member.id,
    )
    if (!device) throw new DemoApiError('BARK_DEVICE_NOT_FOUND', 'Bark 设备不存在')
    const sentAt = nowIso()
    device.lastSuccessAt = sentAt
    device.updatedAt = sentAt
    this.addNotification({
      title: 'DormSync · Bark 模拟测试',
      body: `🔔 ${device.label} 的模拟 Bark 通知`,
      channels: ['bark'],
      createdAt: sentAt,
    })
    return { sent: true, sentAt }
  }

  private registerBarkDevice(payload: Record<string, unknown>) {
    const member = this.requireMember(payload.memberToken)
    const label = cleanText(payload.deviceLabel, 30) || '体验 Bark 设备'
    const device: DemoBarkRecord = {
      id: crypto.randomUUID(),
      memberId: member.id,
      label,
      maskedKey: '••••DEMO',
      createdAt: nowIso(),
      updatedAt: nowIso(),
      lastSuccessAt: nowIso(),
    }
    this.barkDevices.push(device)
    const { memberId: _memberId, ...view } = device
    return { device: view, configured: true }
  }

  private removeBarkDevice(payload: Record<string, unknown>) {
    const member = this.requireMember(payload.memberToken)
    const id = String(payload.deviceId || '')
    this.barkDevices = this.barkDevices.filter(
      (device) => !(device.id === id && device.memberId === member.id),
    )
    return { removed: true }
  }

  private addNotification(
    input: Omit<DemoNotification, 'id' | 'createdAt'> & { createdAt?: string },
  ): DemoNotification {
    const notification: DemoNotification = {
      id: crypto.randomUUID(),
      title: input.title,
      body: input.body,
      channels: [...input.channels],
      createdAt: input.createdAt || nowIso(),
    }
    this.notifications.unshift(notification)
    this.notifications = this.notifications.slice(0, 30)
    window.dispatchEvent(
      new CustomEvent(DEMO_NOTIFICATION_EVENT, { detail: notification }),
    )
    return notification
  }
}

export { DemoApiError }
