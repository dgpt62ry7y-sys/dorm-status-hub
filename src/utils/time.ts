import type { StatusRecord } from '../types/dorm'
import { getStatusOption } from '../types/dorm'

const timeFormatter = new Intl.DateTimeFormat('zh-CN', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

const relativeFormatter = new Intl.RelativeTimeFormat('zh-CN', { numeric: 'auto' })
const LEGACY_EXPIRED_NOTE = '预计时间已结束'

export function formatClock(value: string | Date | null): string {
  if (!value) return '未设置'
  return timeFormatter.format(new Date(value))
}

export function formatRelativeTime(value: string, now = new Date()): string {
  const diffMinutes = Math.round((new Date(value).getTime() - now.getTime()) / 60000)

  if (Math.abs(diffMinutes) < 1) return '刚刚更新'
  if (Math.abs(diffMinutes) < 60) return relativeFormatter.format(diffMinutes, 'minute')

  const diffHours = Math.round(diffMinutes / 60)
  if (Math.abs(diffHours) < 24) return relativeFormatter.format(diffHours, 'hour')

  const diffDays = Math.round(diffHours / 24)
  return relativeFormatter.format(diffDays, 'day')
}

export function toDateTimeLocal(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function buildEndAt(time: string, now = new Date()): { endAt: string; isNextDay: boolean } {
  const [hours = 0, minutes = 0] = time.split(':').map(Number)
  const target = new Date(now)
  target.setHours(hours, minutes, 0, 0)

  const isNextDay = target.getTime() <= now.getTime()
  if (isNextDay) target.setDate(target.getDate() + 1)

  return { endAt: target.toISOString(), isNextDay }
}

export function getEffectiveStatus(record: StatusRecord, now = new Date()): StatusRecord {
  if (!record.endAt || new Date(record.endAt).getTime() > now.getTime()) {
    return record.note === LEGACY_EXPIRED_NOTE ? { ...record, note: '' } : record
  }

  return {
    ...record,
    status: 'normal',
    note: '',
    endAt: null,
  }
}

export function formatDateLabel(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'short',
    day: 'numeric',
  }).format(new Date(value))
}

export function formatHeaderDate(now = new Date()): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(now)
}

export function statusSummary(record: StatusRecord): string {
  const option = getStatusOption(record.status)
  if (record.status === 'sleep' && record.endAt) return `预计 ${formatClock(record.endAt)} 起床`
  if (record.status === 'focus' && record.endAt) return `预计 ${formatClock(record.endAt)} 结束`
  if (record.status === 'away' && record.endAt) return `预计 ${formatClock(record.endAt)} 回寝`
  return option.description
}
