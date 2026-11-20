import { onBeforeUnmount, watch, type Ref } from 'vue'

let activeLocks = 0
let bodyOverflow = ''
let htmlOverflow = ''

function lockPageScroll(): void {
  if (activeLocks === 0) {
    bodyOverflow = document.body.style.overflow
    htmlOverflow = document.documentElement.style.overflow
    document.body.style.overflow = 'hidden'
    document.documentElement.style.overflow = 'hidden'
  }
  activeLocks += 1
}

function unlockPageScroll(): void {
  activeLocks = Math.max(0, activeLocks - 1)
  if (activeLocks === 0) {
    document.body.style.overflow = bodyOverflow
    document.documentElement.style.overflow = htmlOverflow
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
