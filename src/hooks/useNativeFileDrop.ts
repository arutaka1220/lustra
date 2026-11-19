import { useEffect, useRef, useState } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { candidatesFromDroppedPaths } from '../features/import/photo-picker'
import type { ImportCandidate } from '../types/photo'

type UseNativeFileDropOptions = {
  onCandidates: (candidates: ImportCandidate[]) => void
  enabled: boolean
}

export function useNativeFileDrop({ onCandidates, enabled }: UseNativeFileDropOptions) {
  const onCandidatesRef = useRef(onCandidates)
  const [isDragging, setIsDragging] = useState(false)

  useEffect(() => {
    onCandidatesRef.current = onCandidates
  }, [onCandidates])

  useEffect(() => {
    if (!isTauri() || !enabled) return

    let unlisten: (() => void) | undefined
    let disposed = false
    void getCurrentWindow().onDragDropEvent((event) => {
      const { payload } = event
      if (payload.type === 'enter' || payload.type === 'over') setIsDragging(true)
      if (payload.type === 'leave') setIsDragging(false)
      if (payload.type === 'drop') {
        setIsDragging(false)
        void candidatesFromDroppedPaths(payload.paths)
          .then((candidates) => { if (!disposed) onCandidatesRef.current(candidates) })
          .catch((error) => console.error('Could not read dropped photos', error))
      }
    }).then((stopListening) => {
      if (disposed) stopListening()
      else unlisten = stopListening
    }).catch((error) => console.error('Could not listen for dropped photos', error))

    return () => {
      disposed = true
      unlisten?.()
    }
  }, [enabled])

  return enabled && isDragging
}
