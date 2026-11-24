import { invoke, isTauri } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { getSessionSnapshot, restoreSessionSnapshot, useSessionStore } from './session-store'
import type { SessionSnapshot } from './session-store'

const AUTOSAVE_DELAY = 1000
const PERFORMANCE_KEY = 'session.performance'

type RestoredSessions = { snapshot: SessionSnapshot | null; missingPaths: string[] }
type PerformancePreferences = { recentLimit: number; undoLimit: number }
type PersistenceStatus = { ready: boolean; error: string | null }
type SessionState = ReturnType<typeof useSessionStore.getState>

let preferenceWrites: Promise<unknown> = Promise.resolve()

function queuePreferenceWrite(write: () => Promise<void>): Promise<void> {
  const result = preferenceWrites.then(write)
  preferenceWrites = result.catch(() => undefined)
  return result
}

function readBrowserPreference<T>(key: string): T | null {
  const value = localStorage.getItem(`lustra.preferences.${key}`)
  return value === null ? null : JSON.parse(value) as T
}

async function writeBrowserPreference<T>(key: string, value: T): Promise<void> {
  localStorage.setItem(`lustra.preferences.${key}`, JSON.stringify(value))
}

export async function readAppPreference<T>(key: string): Promise<T | null> {
  await preferenceWrites
  return isTauri() ? invoke<T | null>('load_preferences', { key }) : readBrowserPreference<T>(key)
}

export function writeAppPreference<T>(key: string, value: T): Promise<void> {
  return queuePreferenceWrite(() => isTauri()
    ? invoke('save_preferences', { key, value })
    : writeBrowserPreference(key, value))
}

export async function readMetadataCorrections<T>(): Promise<T | null> {
  await preferenceWrites
  return isTauri()
    ? invoke<T | null>('read_metadata_corrections')
    : readBrowserPreference<T>('metadata.corrections')
}

export function writeMetadataCorrections<T>(value: T): Promise<void> {
  return queuePreferenceWrite(() => isTauri()
    ? invoke('write_metadata_corrections', { value })
    : writeBrowserPreference('metadata.corrections', value))
}

let status: PersistenceStatus = { ready: false, error: null }
const listeners = new Set<() => void>()
let restoring: Promise<void> | null = null
let saving: Promise<void> | null = null
let revision = 0
let savedRevision = 0
let timer: ReturnType<typeof setTimeout> | undefined
let closing = false
const windowCloseGuards = new Set<() => boolean>()
let pendingPerformance: PerformancePreferences | null = null
let performanceReadFailed = false
let recoveryOnly = false

function subscribeStatus(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function reportStatus(next: PersistenceStatus) {
  if (status.ready === next.ready && status.error === next.error) return
  status = next
  listeners.forEach((listener) => listener())
}

function explain(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function reportPersistenceError(error: unknown) {
  reportStatus({ ...status, error: explain(error) })
}

async function savePerformance(): Promise<void> {
  const preferences = pendingPerformance
  if (!preferences) return
  await writeAppPreference(PERFORMANCE_KEY, preferences)
  if (pendingPerformance === preferences) pendingPerformance = null
}

async function loadPerformance(): Promise<void> {
  const preferences = await readAppPreference<PerformancePreferences>(PERFORMANCE_KEY)
  if (preferences) {
    const { setRecentLimit, setUndoLimit } = useSessionStore.getState()
    setRecentLimit(preferences.recentLimit)
    setUndoLimit(preferences.undoLimit)
  }
  performanceReadFailed = false
}

async function drainSessionWrites(): Promise<void> {
  while (savedRevision < revision) {
    const currentRevision = revision
    const state = useSessionStore.getState()
    const snapshot = getSessionSnapshot(state)
    if (isTauri()) {
      await invoke('save_sessions', { snapshot })
      scheduleRecentThumbnails(state.recentSessions)
    }
    savedRevision = currentRevision
  }
}

export async function flushSessionPersistence(): Promise<void> {
  clearTimeout(timer)
  if (!status.ready) return
  while (savedRevision < revision) {
    saving ??= drainSessionWrites().finally(() => { saving = null })
    await saving
  }
}

function saveNow() {
  void Promise.all([flushSessionPersistence(), savePerformance()]).then(() => {
    if (!performanceReadFailed) reportStatus({ ready: true, error: null })
  }, reportPersistenceError)
}

function sessionChanged(state: SessionState, previous: SessionState): boolean {
  return state.photos !== previous.photos
    || state.commonFrame !== previous.commonFrame
    || state.activePhotoId !== previous.activePhotoId
    || state.removedPhotos !== previous.removedPhotos
    || state.history !== previous.history
    || state.pendingEdit !== previous.pendingEdit
    || state.recentSessions !== previous.recentSessions
    || state.suspendedSessions !== previous.suspendedSessions
    || state.parkedSession !== previous.parkedSession
    || state.sessionId !== previous.sessionId
    || state.activeRecentId !== previous.activeRecentId
    || state.editMode !== previous.editMode
    || state.filmstripOpen !== previous.filmstripOpen
    || state.screen !== previous.screen
}

function onStoreChanged(state: SessionState, previous: SessionState) {
  if (recoveryOnly) return
  const performanceChanged = state.recentLimit !== previous.recentLimit || state.undoLimit !== previous.undoLimit
  if (performanceChanged) {
    pendingPerformance = { recentLimit: state.recentLimit, undoLimit: state.undoLimit }
  }
  const changed = sessionChanged(state, previous)
  if (changed) revision += 1
  if (!changed && !performanceChanged) return

  clearTimeout(timer)
  if (performanceChanged
    || state.activePhotoId !== previous.activePhotoId
    || state.screen !== previous.screen
    || state.sessionId !== previous.sessionId
    || state.recentSessions !== previous.recentSessions) {
    saveNow()
  } else {
    timer = setTimeout(saveNow, AUTOSAVE_DELAY)
  }
}

export function registerWindowCloseGuard(guard: () => boolean): () => void {
  windowCloseGuards.add(guard)
  return () => { windowCloseGuards.delete(guard) }
}

async function attachCloseHandler(): Promise<void> {
  const window = getCurrentWindow()
  await window.onCloseRequested(async (event) => {
    event.preventDefault()
    if (closing || Array.from(windowCloseGuards).some((guard) => guard())) return
    closing = true
    try {
      await Promise.all([flushSessionPersistence(), savePerformance()])
      await preferenceWrites
      await flushSessionPersistence()
      await window.destroy()
    } catch (error) {
      reportPersistenceError(error)
      closing = false
    }
  })
}

function startRestore(): void {
  if (status.ready || restoring) return
  reportStatus({ ready: false, error: null })
  restoring = (async () => {
    const [restored, performance] = await Promise.allSettled([
      isTauri() ? invoke<RestoredSessions>('load_sessions') : Promise.resolve(null),
      loadPerformance(),
    ])
    if (restored.status === 'rejected') throw restored.reason
    const archive = restored.value
    let recentSessionsTrimmed = false
    if (archive?.snapshot) {
      if (isTauri()) {
        const workspaces = [archive.snapshot.active, ...(archive.snapshot.parked ? [archive.snapshot.parked] : []), ...(archive.snapshot.suspended ?? []), ...archive.snapshot.recent]
        const paths = workspaces.flatMap((workspace) => workspace.photos
          .filter((photo) => photo.source.kind === 'path' && !archive.missingPaths.includes(photo.source.path))
          .map((photo) => photo.source.path))
        await invoke('allow_photo_paths', { paths })
      }
      restoreSessionSnapshot(archive.snapshot, archive.missingPaths)
      const { recentSessions } = useSessionStore.getState()
      recentSessionsTrimmed = recentSessions.length < archive.snapshot.recent.length
      scheduleRecentThumbnails(recentSessions, true)
    }
    if (isTauri()) await attachCloseHandler()
    recoveryOnly = false
    useSessionStore.subscribe(onStoreChanged)
    performanceReadFailed = performance.status === 'rejected'
    reportStatus({ ready: true, error: performance.status === 'rejected' ? explain(performance.reason) : null })
    if (recentSessionsTrimmed && !performanceReadFailed) {
      revision += 1
      saveNow()
    }
  })().catch(reportPersistenceError).finally(() => { restoring = null })
}

function retry() {
  if (recoveryOnly) {
    recoveryOnly = false
    reportStatus({ ready: false, error: null })
    startRestore()
  } else if (!status.ready) startRestore()
  else if (performanceReadFailed) void loadPerformance().then(saveNow, reportPersistenceError)
  else saveNow()
}

export function useSessionPersistence() {
  const current = useSyncExternalStore(subscribeStatus, () => status)
  useEffect(startRestore, [])
  const goHome = () => {
    if (current.ready || !current.error) return
    recoveryOnly = true
    useSessionStore.getState().setScreen('welcome')
    reportStatus({ ready: true, error: current.error })
  }
  return { ...current, retry, goHome, protectedArchive: recoveryOnly }
}

const thumbnailObservers = new Set<(id?: string) => void>()
const requestedThumbnails = new Map<string, number>()
let thumbnailGeneration = 0
let thumbnailWrites = Promise.resolve()

async function thumbnailBytes(url: string): Promise<number[]> {
  const image = new Image()
  image.crossOrigin = 'anonymous'
  image.src = url
  await image.decode()
  const scale = Math.min(1, 220 / Math.max(image.naturalWidth, image.naturalHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas is unavailable.')
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82))
  if (!blob) throw new Error('Could not encode the session thumbnail.')
  return Array.from(new Uint8Array(await blob.arrayBuffer()))
}

function scheduleRecentThumbnails(recentSessions: SessionState['recentSessions'], loadExisting = false) {
  const retained = new Set(recentSessions.map((session) => session.id))
  for (const id of requestedThumbnails.keys()) {
    if (!retained.has(id)) requestedThumbnails.delete(id)
  }
  for (const session of recentSessions) {
    const { id, updatedAt, photos } = session
    if (requestedThumbnails.get(id) === updatedAt) continue
    const source = photos.find(({ source }) => source.kind === 'path' && !source.missing)?.source
    if (!source) continue
    requestedThumbnails.set(id, updatedAt)
    const generation = thumbnailGeneration
    const isLatest = () => thumbnailGeneration === generation && requestedThumbnails.get(id) === updatedAt
    thumbnailWrites = thumbnailWrites.then(async () => {
      if (!isLatest()) return
      if (loadExisting && await invoke<number[] | null>('load_session_thumbnail', { sessionId: id })) return
      const bytes = await thumbnailBytes(source.url)
      if (!isLatest()) return
      await invoke('save_session_thumbnail', { sessionId: id, bytes })
      thumbnailObservers.forEach((refresh) => refresh(id))
    }).catch((error) => console.warn('Could not cache session thumbnail', error))
  }
}

export async function getThumbnailCacheSize(): Promise<number> {
  return isTauri() ? invoke<number>('thumbnail_cache_size') : 0
}

export async function clearThumbnailCache(): Promise<void> {
  thumbnailGeneration += 1
  if (isTauri()) await invoke('clear_thumbnail_cache')
  thumbnailObservers.forEach((refresh) => refresh())
}

export function useRecentThumbnail(sessionId: string | null): string | null {
  const [thumbnail, setThumbnail] = useState<{ id: string; url: string } | null>(null)
  useEffect(() => {
    if (!sessionId || !isTauri()) return
    let version = 0
    let url: string | null = null
    const refresh = (id?: string) => {
      if (id && id !== sessionId) return
      const request = ++version
      void invoke<number[] | null>('load_session_thumbnail', { sessionId }).then((bytes) => {
        if (request !== version) return
        if (url) URL.revokeObjectURL(url)
        url = bytes ? URL.createObjectURL(new Blob([Uint8Array.from(bytes)], { type: 'image/jpeg' })) : null
        setThumbnail(url ? { id: sessionId, url } : null)
      }).catch((error) => console.warn('Could not load session thumbnail', error))
    }
    thumbnailObservers.add(refresh)
    refresh()
    return () => {
      thumbnailObservers.delete(refresh)
      version += 1
      if (url) URL.revokeObjectURL(url)
    }
  }, [sessionId])
  return thumbnail?.id === sessionId ? thumbnail.url : null
}
