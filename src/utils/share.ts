export interface ShareResult {
  method: 'share' | 'clipboard'
  message: string
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
