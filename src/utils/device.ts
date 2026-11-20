export function getDeviceLabel(): string {
  const userAgent = navigator.userAgent

  let platform = '其他设备'
  if (/iPhone/i.test(userAgent)) platform = 'iPhone'
  else if (/iPad/i.test(userAgent)) platform = 'iPad'
  else if (/Macintosh/i.test(userAgent) && navigator.maxTouchPoints > 1) platform = 'iPad'
  else if (/Android/i.test(userAgent)) platform = 'Android'
  else if (/Macintosh|Mac OS X/i.test(userAgent)) platform = 'Mac'
  else if (/Windows/i.test(userAgent)) platform = 'Windows'
  else if (/Linux/i.test(userAgent)) platform = 'Linux'

  let browser = '浏览器'
  if (/MicroMessenger/i.test(userAgent)) browser = '微信'
  else if (/Edg\//i.test(userAgent)) browser = 'Edge'
  else if (/CriOS\//i.test(userAgent)) browser = 'Chrome'
  else if (/FxiOS\//i.test(userAgent)) browser = 'Firefox'
  else if (/Firefox\//i.test(userAgent)) browser = 'Firefox'
  else if (/Chrome\//i.test(userAgent)) browser = 'Chrome'
  else if (/Safari\//i.test(userAgent)) browser = 'Safari'

  return `${platform} · ${browser}`
}
