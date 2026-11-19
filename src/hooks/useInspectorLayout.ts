import { useCallback, useEffect, useRef, useState } from 'react'
import type { PointerEvent } from 'react'
import { readAppPreference, writeAppPreference } from '../store/session-persistence'

const STORAGE_KEY = 'lustra.editor-layout'
const PREF_KEY = 'editor.layout'
export const DEFAULT_INSPECTOR_WIDTH = 300
const MIN_INSPECTOR_WIDTH = 260
const MAX_INSPECTOR_WIDTH = 450

type SavedLayout = { inspectorWidth?: number; inspectorOpen?: boolean }
type Layout = Required<SavedLayout>

function clampWidth(width: number): number {
  return Math.max(MIN_INSPECTOR_WIDTH, Math.min(MAX_INSPECTOR_WIDTH, width))
}

function normalizeLayout(saved: SavedLayout | null): Layout {
  const width = saved?.inspectorWidth
  return {
    inspectorWidth: typeof width === 'number' && Number.isFinite(width) ? clampWidth(width) : DEFAULT_INSPECTOR_WIDTH,
    inspectorOpen: typeof saved?.inspectorOpen === 'boolean' ? saved.inspectorOpen : true,
  }
}

function readLegacyLayout(): SavedLayout | null {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as SavedLayout | null
  } catch {
    return null
  }
}

function saveLayout(layout: Layout) {
  void writeAppPreference(PREF_KEY, layout).catch((error) => console.warn('Could not save inspector layout', error))
}

export function useInspectorLayout() {
  const [layout, setLayout] = useState(() => normalizeLayout(readLegacyLayout()))
  const layoutRef = useRef(layout)
  const edited = useRef(false)

  useEffect(() => {
    let live = true
    void readAppPreference<SavedLayout>(PREF_KEY).then((saved) => {
      if (!live || edited.current) return
      const legacy = saved === null ? readLegacyLayout() : null
      const next = normalizeLayout(saved ?? legacy)
      layoutRef.current = next
      setLayout(next)
      if (legacy) saveLayout(next)
    }).catch((error) => console.warn('Could not restore inspector layout', error))
    return () => { live = false }
  }, [])

  const updateLayout = useCallback((update: (previous: Layout) => Layout, persist = true) => {
    const next = update(layoutRef.current)
    if (next === layoutRef.current) return
    edited.current = true
    layoutRef.current = next
    setLayout(next)
    if (persist) saveLayout(next)
  }, [])

  const toggleInspector = useCallback(() => {
    updateLayout((previous) => ({ ...previous, inspectorOpen: !previous.inspectorOpen }))
  }, [updateLayout])

  const revealInspector = useCallback(() => {
    updateLayout((previous) => previous.inspectorOpen ? previous : { ...previous, inspectorOpen: true })
  }, [updateLayout])

  const resetInspectorWidth = useCallback(() => {
    updateLayout((previous) => ({ ...previous, inspectorWidth: DEFAULT_INSPECTOR_WIDTH }))
  }, [updateLayout])

  const startResize = useCallback((event: PointerEvent<HTMLElement>) => {
    event.preventDefault()
    const initialX = event.clientX
    const initialWidth = layoutRef.current.inspectorWidth
    document.body.classList.add('is-resizing-inspector')

    const onPointerMove = (moveEvent: globalThis.PointerEvent) => {
      if (moveEvent.pointerId !== event.pointerId) return
      const inspectorWidth = clampWidth(initialWidth + moveEvent.clientX - initialX)
      updateLayout((previous) => ({ ...previous, inspectorWidth }), false)
    }
    const onPointerUp = (upEvent: globalThis.PointerEvent) => {
      if (upEvent.pointerId !== event.pointerId) return
      document.body.classList.remove('is-resizing-inspector')
      saveLayout(layoutRef.current)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerUp)
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerUp)
  }, [updateLayout])

  const resizeBy = useCallback((amount: number) => {
    updateLayout((previous) => ({ ...previous, inspectorWidth: clampWidth(previous.inspectorWidth + amount) }))
  }, [updateLayout])

  return {
    inspectorWidth: layout.inspectorWidth,
    inspectorOpen: layout.inspectorOpen,
    toggleInspector,
    revealInspector,
    resetInspectorWidth,
    startResize,
    resizeBy,
  }
}
