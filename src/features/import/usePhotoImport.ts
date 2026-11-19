import { useCallback, useEffect, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import { candidatesFromFiles } from './photo-candidates'
import { pickImageFiles, pickImageFolder } from './photo-picker'
import { readPhotoMetadata } from './photo-metadata'
import { useSessionStore } from '../../store/session-store'
import type { ImportCandidate, PhotoSource } from '../../types/photo'
import { useNativeFileDrop } from '../../hooks/useNativeFileDrop'

export function usePhotoImport(ready: boolean, allowImport: boolean) {
  const enabled = ready && allowImport
  const setScreen = useSessionStore((state) => state.setScreen)
  const addCandidates = useSessionStore((state) => state.addCandidates)
  const photos = useSessionStore((state) => state.photos)
  const setCandidateMetadata = useSessionStore((state) => state.setCandidateMetadata)
  const [formatNoticeOpen, setFormatNoticeOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)
  const importEnabled = useRef(enabled)
  importEnabled.current = enabled
  const pending = useRef<ImportCandidate[]>([])
  const queuedSources = useRef(new WeakSet<PhotoSource>())
  const running = useRef(0)

  const readNext = useCallback(function readNext() {
    while (running.current < 3 && pending.current.length) {
      const candidate = pending.current.shift()
      if (!candidate) break
      running.current += 1
      void readPhotoMetadata(candidate).then((result) => {
        if (result.diagnostics?.length) {
          console.debug('[Lustra metadata]', result.status, result.diagnostics)
        }
        const state = result.status === 'complete' ? 'ready' : result.status
        setCandidateMetadata(candidate.id, result.metadata, state, candidate.source)
      }).catch((error) => {
        console.warn('[Lustra metadata] Could not read source file', error)
        setCandidateMetadata(candidate.id, {}, 'fileError', candidate.source)
      }).finally(() => {
        running.current -= 1
        readNext()
      })
    }
  }, [setCandidateMetadata])

  const queueMetadata = useCallback((items: ImportCandidate[]) => {
    for (const item of items) {
      if (!item.source.url || item.metadataState !== 'loading' || queuedSources.current.has(item.source)) continue
      queuedSources.current.add(item.source)
      pending.current.push(item)
    }
    readNext()
  }, [readNext])

  useEffect(() => {
    if (ready) queueMetadata(photos)
  }, [ready, photos, queueMetadata])

  const addToImport = useCallback((incoming: ImportCandidate[]) => {
    if (!importEnabled.current) {
      for (const candidate of incoming) {
        if (candidate.source.kind === 'file') URL.revokeObjectURL(candidate.source.url)
      }
      return
    }
    if (!incoming.length) return
    if (!localStorage.getItem('lustra.png-webp-notice') && incoming.some((candidate) => /\.(png|webp)$/i.test(candidate.name))) {
      setFormatNoticeOpen(true)
    }

    addCandidates(incoming)
    setScreen('import')

    const incomingSources = new Set(incoming.map((item) => item.source))
    queueMetadata(useSessionStore.getState().candidates.filter((item) => incomingSources.has(item.source)))
  }, [addCandidates, queueMetadata, setScreen])

  const isNativeDragging = useNativeFileDrop({ onCandidates: addToImport, enabled })

  const openFiles = useCallback(async () => {
    if (!importEnabled.current) return
    if (!isTauri()) {
      fileInputRef.current?.click()
      return
    }
    try {
      addToImport(await pickImageFiles())
    } catch (error) {
      console.error('Could not open photos', error)
    }
  }, [addToImport])

  const openFolder = useCallback(async () => {
    if (!importEnabled.current) return
    if (!isTauri()) {
      folderInputRef.current?.click()
      return
    }
    try {
      addToImport(await pickImageFolder() ?? [])
    } catch (error) {
      console.error('Could not open folder', error)
    }
  }, [addToImport])

  const handleBrowserFiles = useCallback((fileList: FileList | null, folder = false) => {
    if (!importEnabled.current || !fileList) return
    const files = Array.from(fileList).filter((file) => {
      if (!folder) return true
      const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath ?? ''
      return relativePath.split('/').filter(Boolean).length <= 2
    })
    addToImport(candidatesFromFiles(files))
  }, [addToImport])

  const handleDrop = useCallback((event: DragEvent<HTMLElement>) => {
    event.preventDefault()
    event.stopPropagation()
    if (importEnabled.current && event.dataTransfer.files.length) addToImport(candidatesFromFiles(event.dataTransfer.files))
  }, [addToImport])

  const dismissFormatNotice = useCallback(() => {
    localStorage.setItem('lustra.png-webp-notice', 'seen')
    setFormatNoticeOpen(false)
  }, [])

  return {
    fileInputRef,
    folderInputRef,
    formatNoticeOpen,
    isNativeDragging,
    openFiles,
    openFolder,
    handleBrowserFiles,
    handleDrop,
    dismissFormatNotice,
  }
}
