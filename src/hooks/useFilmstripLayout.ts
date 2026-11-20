import { useCallback, useEffect, useRef, useState } from 'react'
import type { PointerEvent } from 'react'
import { readAppPreference, writeAppPreference } from '../store/session-persistence'
import { clampFilmstripHeight, DEFAULT_FILMSTRIP_HEIGHT } from '../features/editor/filmstrip-layout'

const PREF_KEY = 'editor.filmstrip-height'

function saveHeight(height: number) {
  void writeAppPreference(PREF_KEY, height).catch((error) => console.warn('Could not save filmstrip height', error))
}

export function useFilmstripLayout() {
  const [height, setHeight] = useState(DEFAULT_FILMSTRIP_HEIGHT)
  const heightRef = useRef(height)
  const edited = useRef(false)

  const update = useCallback((value: number, persist: boolean) => {
    const editor = document.querySelector<HTMLElement>('.editor-layout')
    const next = clampFilmstripHeight(value, window.innerHeight, editor?.clientHeight ?? window.innerHeight)
    if (next === heightRef.current) return
    heightRef.current = next
    setHeight(next)
    if (persist) {
      edited.current = true
      saveHeight(next)
    }
  }, [])

  useEffect(() => {
    let live = true
    void readAppPreference<number>(PREF_KEY).then((saved) => {
      if (!live || edited.current) return
      if (saved !== null) update(saved, false)
    }).catch((error) => console.warn('Could not restore filmstrip height', error))
    return () => { live = false }
  }, [update])

  useEffect(() => {
    const editor = document.querySelector<HTMLElement>('.editor-layout')
    if (!editor) return
    const resize = () => update(heightRef.current, false)
    window.addEventListener('resize', resize)
    const observer = new ResizeObserver(resize)
    observer.observe(editor)
    return () => { window.removeEventListener('resize', resize); observer.disconnect() }
  }, [update])

  const reset = useCallback(() => update(DEFAULT_FILMSTRIP_HEIGHT, true), [update])
  const startResize = useCallback((event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const initialY = event.clientY
    const initialHeight = heightRef.current
    document.body.classList.add('is-resizing-filmstrip')
    const onMove = (move: globalThis.PointerEvent) => {
      if (move.pointerId === event.pointerId) update(initialHeight + initialY - move.clientY, false)
    }
    const onUp = (up: globalThis.PointerEvent) => {
      if (up.pointerId !== event.pointerId) return
      document.body.classList.remove('is-resizing-filmstrip')
      edited.current = true
      saveHeight(heightRef.current)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }, [update])

  const resizeBy = useCallback((amount: number) => update(heightRef.current + amount, true), [update])
  return { height, startResize, reset, resizeBy }
}
