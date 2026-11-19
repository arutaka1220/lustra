import { useEffect } from 'react'
import { canRedo, canUndo, useSessionStore } from '../store/session-store'
import type { WorkspaceScreen } from '../store/session-store'

export function useEditorShortcuts(screen: WorkspaceScreen) {
  useEffect(() => {
    if (screen === 'export' || screen === 'import') return

    const onKeyDown = (event: KeyboardEvent) => {
      const state = useSessionStore.getState()
      const target = event.target instanceof HTMLElement ? event.target : null
      const { lustraTextDrag, lustraPreviewDrag } = document.documentElement.dataset
      if (event.defaultPrevented || event.isComposing || state.settingsOpen || state.frameEditActive || lustraTextDrag || lustraPreviewDrag) return
      if (target?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="combobox"], [role="listbox"], [role="option"], [role="slider"], [role="separator"], [role="dialog"]')) return
      if (event.metaKey || event.ctrlKey) {
        if (event.altKey) return
        if (event.key.toLowerCase() === 'z') {
          const redo = event.shiftKey
          if (!(redo ? canRedo(state) : canUndo(state))) return
          event.preventDefault()
          if (redo) state.redo()
          else state.undo()
        } else if (event.key === 'Enter' && screen === 'edit') {
          event.preventDefault()
          state.doneNext()
        }
        return
      }
      if (screen !== 'edit' || event.altKey || event.shiftKey) return
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault()
        if (event.key === 'ArrowLeft') state.previousPhoto()
        else state.nextPhoto()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [screen])
}
