export interface ShareResult {
  method: 'share' | 'clipboard'
  message: string
}

export function getDemoExperienceUrl(): string {
  const current = new URL(window.location.href)
  const url = new URL(import.meta.env.BASE_URL, current)
  if (import.meta.env.BASE_URL === './' && current.pathname.endsWith('.html')) {
    url.pathname = current.pathname
  }
  url.search = ''
  url.hash = '#/'
  return url.toString()
}

export async function shareDormInvite(roomName: string, inviteCode: string): Promise<ShareResult> {
  const url = new URL(window.location.href)
  url.pathname = '/'
  url.search = `?invite=${encodeURIComponent(inviteCode)}`
  url.hash = ''

  const text = `加入「${roomName}」，邀请码：${inviteCode}`

  if (navigator.share) {
    await navigator.share({
      title: '宿舍状态共享站',
      text,
      url: url.toString(),
    })
    return { method: 'share', message: '邀请已准备好，可以发送到群里了' }
  }

  const shareText = `${text}\n${url.toString()}`

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(shareText)
  } else {
    const textarea = document.createElement('textarea')
    textarea.value = shareText
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    textarea.remove()
  }

  return { method: 'clipboard', message: '邀请链接和邀请码已复制' }
}

export async function shareDemoExperience(): Promise<ShareResult> {
  const url = new URL(getDemoExperienceUrl())
  const text = '打开「宿舍状态共享站」体验版，直接体验六人寝状态共享和双通道通知。'

  if (navigator.share) {
    await navigator.share({
      title: '宿舍状态共享站 · 体验版',
      text,
      url: url.toString(),
    })
    return { method: 'share', message: '体验链接已准备好' }
  }

  const shareText = `${text}\n${url.toString()}`
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(shareText)
  } else {
    const textarea = document.createElement('textarea')
    textarea.value = shareText
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    textarea.remove()
  }
  return { method: 'clipboard', message: '体验链接已复制' }
}
