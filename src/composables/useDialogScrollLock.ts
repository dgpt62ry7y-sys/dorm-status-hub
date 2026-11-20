import { onBeforeUnmount, watch, type Ref } from 'vue'

let activeLocks = 0
let savedScrollY = 0
let bodyStyle: Pick<CSSStyleDeclaration, 'position' | 'top' | 'left' | 'right' | 'width' | 'overflow'> | null =
  null
let htmlOverflow = ''
let lastTouchY = 0

function isElement(value: EventTarget | null): value is Element {
  return value instanceof Element
}

function findScrollableContainer(target: EventTarget | null): HTMLElement | null {
  if (!isElement(target)) return null
  const layer = target.closest<HTMLElement>('.dialog-layer, .sheet-layer')
  if (!layer) return null

  let node: Element | null = target
  while (node && node !== layer.parentElement) {
    if (node instanceof HTMLElement) {
      const style = getComputedStyle(node)
      const canScrollY =
        style.overflowY === 'auto' || style.overflowY === 'scroll'
      if (canScrollY && node.scrollHeight > node.clientHeight + 1) {
        return node
      }
    }
    node = node.parentElement
  }
  return null
}

function handleTouchStart(event: TouchEvent): void {
  lastTouchY = event.touches[0]?.clientY ?? 0
}

function handleTouchMove(event: TouchEvent): void {
  const touch = event.touches[0]
  if (!touch) return

  const scroller = findScrollableContainer(event.target)
  if (!scroller) {
    event.preventDefault()
    return
  }

  const deltaY = lastTouchY - touch.clientY
  if (deltaY !== 0) {
    const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
    scroller.scrollTop = Math.min(
      maxScrollTop,
      Math.max(0, scroller.scrollTop + deltaY),
    )
  }
  event.preventDefault()
  lastTouchY = touch.clientY
}

function lockPageScroll(): void {
  if (activeLocks === 0) {
    savedScrollY = window.scrollY
    bodyStyle = {
      position: document.body.style.position,
      top: document.body.style.top,
      left: document.body.style.left,
      right: document.body.style.right,
      width: document.body.style.width,
      overflow: document.body.style.overflow,
    }
    htmlOverflow = document.documentElement.style.overflow
    document.body.style.position = 'fixed'
    document.body.style.top = `-${savedScrollY}px`
    document.body.style.left = '0'
    document.body.style.right = '0'
    document.body.style.width = '100%'
    document.body.style.overflow = 'hidden'
    document.documentElement.style.overflow = 'hidden'
    document.addEventListener('touchstart', handleTouchStart, {
      capture: true,
      passive: true,
    })
    document.addEventListener('touchmove', handleTouchMove, {
      capture: true,
      passive: false,
    })
  }
  activeLocks += 1
}

function unlockPageScroll(): void {
  activeLocks = Math.max(0, activeLocks - 1)
  if (activeLocks === 0 && bodyStyle) {
    document.removeEventListener('touchstart', handleTouchStart, true)
    document.removeEventListener('touchmove', handleTouchMove, true)
    document.body.style.position = bodyStyle.position
    document.body.style.top = bodyStyle.top
    document.body.style.left = bodyStyle.left
    document.body.style.right = bodyStyle.right
    document.body.style.width = bodyStyle.width
    document.body.style.overflow = bodyStyle.overflow
    document.documentElement.style.overflow = htmlOverflow
    window.scrollTo(0, savedScrollY)
    bodyStyle = null
  }
}

export function useDialogScrollLock(isOpen: Readonly<Ref<boolean>>): void {
  let locked = false

  function sync(open: boolean): void {
    if (open && !locked) {
      locked = true
      lockPageScroll()
    } else if (!open && locked) {
      locked = false
      unlockPageScroll()
    }
  }

  watch(isOpen, sync, { immediate: true, flush: 'post' })

  onBeforeUnmount(() => {
    if (locked) {
      locked = false
      unlockPageScroll()
    }
  })
}
