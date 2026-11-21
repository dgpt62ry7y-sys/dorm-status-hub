export interface LastRoomHint {
  inviteCode: string
  roomName: string
  nickname: string
}

const LAST_ROOM_KEY = 'dormsync:last-room:v1'
const LAST_ROOM_COOKIE = 'dormsync_last_room_v1'

function readCookie(): string {
  const prefix = `${LAST_ROOM_COOKIE}=`
  const entry = document.cookie
    .split(';')
    .map((item) => item.trim())
    .find((item) => item.startsWith(prefix))
  return entry ? decodeURIComponent(entry.slice(prefix.length)) : ''
}

function parseHint(value: string): LastRoomHint | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as Partial<LastRoomHint>
    const inviteCode = String(parsed.inviteCode || '').trim().toUpperCase()
    if (!/^[A-Z0-9]{6}$/.test(inviteCode)) return null
    return {
      inviteCode,
      roomName: String(parsed.roomName || '').trim().slice(0, 20),
      nickname: String(parsed.nickname || '').trim().slice(0, 12),
    }
  } catch {
    return null
  }
}

export function saveLastRoomHint(hint: LastRoomHint): void {
  const normalized: LastRoomHint = {
    inviteCode: hint.inviteCode.trim().toUpperCase(),
    roomName: hint.roomName.trim().slice(0, 20),
    nickname: hint.nickname.trim().slice(0, 12),
  }
  if (!/^[A-Z0-9]{6}$/.test(normalized.inviteCode)) return

  const value = JSON.stringify(normalized)
  localStorage.setItem(LAST_ROOM_KEY, value)
  const secure = window.location.protocol === 'https:' ? '; Secure' : ''
  document.cookie = `${LAST_ROOM_COOKIE}=${encodeURIComponent(value)}; Path=/; Max-Age=15552000; SameSite=Lax${secure}`
}

export function getLastRoomHint(): LastRoomHint | null {
  return (
    parseHint(localStorage.getItem(LAST_ROOM_KEY) || '') ||
    parseHint(readCookie())
  )
}
