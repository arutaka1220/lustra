import { useSyncExternalStore } from 'react'

let pressed = false
let listening = false
const subscribers = new Set<() => void>()

function publish(next: boolean) {
  if (pressed === next) return
  pressed = next
  subscribers.forEach((subscriber) => subscriber())
}

function onKey(event: KeyboardEvent) { publish(event.altKey) }
function clear() { publish(false) }
function onVisibility() { if (document.visibilityState !== 'visible') clear() }

function subscribe(subscriber: () => void) {
  subscribers.add(subscriber)
  if (!listening) {
    listening = true
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKey)
    window.addEventListener('blur', clear)
    document.addEventListener('visibilitychange', onVisibility)
  }
  return () => {
    subscribers.delete(subscriber)
    if (subscribers.size === 0 && listening) {
      listening = false
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKey)
      window.removeEventListener('blur', clear)
      document.removeEventListener('visibilitychange', onVisibility)
      clear()
    }
  }
}

/** Tracks Option on macOS and Alt on Windows without consuming the key event. */
export function useResetModifier() {
  return useSyncExternalStore(subscribe, () => pressed, () => false)
}
