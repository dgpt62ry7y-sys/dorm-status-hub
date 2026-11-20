import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import './styles/global.css'

const preventGestureZoom = (event: Event) => event.preventDefault()
const preventMultiTouchZoom = (event: TouchEvent) => {
  if (event.touches.length > 1) event.preventDefault()
}

document.addEventListener('gesturestart', preventGestureZoom, { passive: false })
document.addEventListener('gesturechange', preventGestureZoom, { passive: false })
document.addEventListener('gestureend', preventGestureZoom, { passive: false })
document.addEventListener('touchmove', preventMultiTouchZoom, { passive: false })

createApp(App).use(router).mount('#app')

if (import.meta.env.PROD && !__DEMO_MODE__ && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Offline support is optional; a registration failure should not block the app.
    })
  })
}
