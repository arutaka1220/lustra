import { create } from 'zustand'
import { PHOTO_METADATA_READER_VERSION } from '../types/photo'
import type { FrameSettings, ImportCandidate, PhotoMetadata, PhotoSource, SessionPhoto } from '../types/photo'
import {
  appendChange, applyValues, changedValues, clearRemovedHistory, emptyHistory, getSeries, limitHistory,
  mergeChanges, moveHistoryEntry, pruneHistory, selectRedoSeries, selectUndoSeries, sessionLayout,
} from './session-history'
import type { PhotoEdit, RemovedPhoto, SessionChange, SessionHistory, SessionLayout } from './session-history'
import { deserializeWorkspace, migrateLegacyWhite, serializeWorkspace } from './session-snapshot'
import type { SessionSnapshot, SessionWorkspace } from './session-snapshot'

export type { SessionSnapshot, SessionWorkspace } from './session-snapshot'
export type EditMode = 'all' | 'this'
export type WorkspaceScreen = 'welcome' | 'import' | 'edit' | 'review' | 'export'

export type SessionState = {
  screen: WorkspaceScreen
  candidates: ImportCandidate[]
  candidatesReordered: boolean
  photos: SessionPhoto[]
  removedPhotos: RemovedPhoto[]
  activePhotoId: string | null
  editMode: EditMode
  filmstripOpen: boolean
  settingsOpen: boolean
  commonFrame: FrameSettings
  history: SessionHistory
  frameEditActive: boolean
  pendingEdit: SessionChange | null
  sessionId: string
  recentSessions: SessionWorkspace[]
  parkedSession: SessionWorkspace | null
  activeRecentId: string | null
  recentLimit: number
  undoLimit: number
  setScreen: (screen: WorkspaceScreen) => void
  setCandidates: (updater: (candidates: ImportCandidate[]) => ImportCandidate[]) => void
  addCandidates: (candidates: ImportCandidate[]) => void
  selectAllCandidates: (selected: boolean) => void
  removeCandidate: (id: string) => void
  reorderCandidates: (fromId: string, toId: string) => void
  clearImport: () => void
  importSelected: () => void
  setCandidateMetadata: (id: string, metadata: PhotoMetadata, metadataState: ImportCandidate['metadataState'], expectedSource?: PhotoSource) => void
  setActivePhoto: (id: string) => void
  setEditMode: (mode: EditMode) => void
  updateFrame: <K extends keyof FrameSettings>(key: K, value: FrameSettings[K]) => void
  patchFrame: (changes: Partial<FrameSettings>) => void
  resetPhotoOverride: (id: string, key: keyof FrameSettings) => void
  resetPhotoOverrides: (id: string) => void
  setPhotoMetadataOverrides: (id: string, patch: Partial<PhotoMetadata>) => void
  setCompleted: (id: string, completed: boolean) => void
  doneNext: () => void
  toggleFilmstrip: () => void
  toggleSettings: () => void
  addToSession: (candidates: ImportCandidate[]) => void
  reorderPhotos: (fromId: string, toId: string) => void
  removePhoto: (id: string) => void
  restorePhoto: (id: string) => void
  relinkPhoto: (id: string, source: PhotoSource) => boolean
  markPhotoSourceMissing: (id: string, source: PhotoSource) => void
  nextPhoto: () => void
  previousPhoto: () => void
  beginFrameEdit: () => void
  endFrameEdit: () => void
  undo: () => void
  redo: () => void
  setUndoLimit: (limit: number) => void
  setRecentLimit: (limit: number) => void
  finishSession: () => void
  openRecentSession: (id: string) => void
  resumeCurrentSession: () => void
}

export const initialFrame: FrameSettings = {
  style: 'black',
  top: 8,
  bottom: 15,
  left: 8,
  right: 8,
  linkSides: true,
  linkVertical: false,
  blurStrength: 18,
  backgroundBrightness: 100,
  backgroundOpacity: 100,
  showInset: false,
  showShadow: false,
}

function freshWorkspace() {
  return {
    sessionId: crypto.randomUUID(),
    photos: [],
    removedPhotos: [],
    activePhotoId: null,
    commonFrame: initialFrame,
    editMode: 'all' as const,
    filmstripOpen: true,
    screen: 'welcome' as const,
    history: emptyHistory,
    frameEditActive: false,
    pendingEdit: null,
  }
}

const releaseCandidate = (candidate: ImportCandidate) => {
  if (candidate.source.kind === 'file') URL.revokeObjectURL(candidate.source.url)
}

const isWindows = typeof navigator !== 'undefined' && navigator.platform.startsWith('Win')

function candidateKey(candidate: Pick<ImportCandidate, 'name' | 'source'>) {
  if (candidate.source.kind === 'file') {
    return `file:${candidate.name}:${candidate.source.file.size}:${candidate.source.file.lastModified}`
  }
  return `path:${isWindows ? candidate.source.path.toLowerCase() : candidate.source.path}`
}

function photoKeys(state: SessionState) {
  return new Set([...state.photos, ...state.removedPhotos.map(({ photo }) => photo)].map(candidateKey))
}

function moveItem<T extends { id: string }>(items: T[], fromId: string, toId: string): T[] {
  const from = items.findIndex((item) => item.id === fromId)
  const to = items.findIndex((item) => item.id === toId)
  if (from === -1 || to === -1 || from === to) return items
  const next = [...items]
  next.splice(to, 0, next.splice(from, 1)[0])
  return next
}

function getCommittedHistory(state: SessionState) {
  if (!state.pendingEdit) return state.history
  return commitChange(state, state.history, state.pendingEdit)
}

function closeFrameEdit(state: SessionState) {
  return { frameEditActive: false, pendingEdit: null, history: getCommittedHistory(state) }
}

function commitChange(state: SessionState, history: SessionHistory, change: SessionChange) {
  const updated = appendChange(history, change, state.undoLimit)
  return change.kind === 'common' ? pruneHistory(updated, state.photos, state.removedPhotos) : updated
}

function recordChange(state: SessionState, change: SessionChange) {
  if (change.kind !== 'layout' && !change.values.keys.length) return {}
  if (change.kind !== 'layout' && state.frameEditActive) {
    if (!state.pendingEdit) return { pendingEdit: change }
    const merged = mergeChanges(state.pendingEdit, change)
    if (merged) return { pendingEdit: merged }
    return { history: getCommittedHistory(state), pendingEdit: change }
  }
  return {
    frameEditActive: false,
    pendingEdit: null,
    history: commitChange(state, getCommittedHistory(state), change),
  }
}

function changePhoto(state: SessionState, id: string, update: (photo: SessionPhoto) => SessionPhoto): Partial<SessionState> {
  const index = state.photos.findIndex((photo) => photo.id === id)
  if (index === -1) return state
  const before = state.photos[index]
  const after = update(before)
  const photoEdit = ({ overrides, completed, metadataOverrides, source }: SessionPhoto): PhotoEdit => (
    { overrides, completed, metadataOverrides, source }
  )
  const values = changedValues(photoEdit(before), photoEdit(after))
  if (!values.keys.length) return state
  const photos = [...state.photos]
  photos[index] = after
  return { photos, ...recordChange(state, { kind: 'photo', photoId: id, values }) }
}

function changeLayout(state: SessionState, photos: SessionPhoto[], removedPhotos: RemovedPhoto[], activePhotoId: string | null): Partial<SessionState> {
  const operation = recordChange(state, {
    kind: 'layout',
    before: sessionLayout(state.photos, state.removedPhotos, state.activePhotoId),
    after: sessionLayout(photos, removedPhotos, activePhotoId),
  })
  return {
    photos, removedPhotos, activePhotoId, ...operation,
    history: pruneHistory(operation.history ?? state.history, photos, removedPhotos),
    screen: photos.length === 0 ? 'welcome' : state.screen,
  }
}

function applyLayout(state: SessionState, history: SessionHistory, layout: SessionLayout, other: SessionLayout): Partial<SessionState> {
  const catalog = new Map(Object.entries(history.detachedPhotos))
  state.photos.forEach((photo) => catalog.set(photo.id, photo))
  state.removedPhotos.forEach(({ photo }) => catalog.set(photo.id, photo))
  const photos = layout.photoIds.flatMap((id) => {
    const photo = catalog.get(id)
    return photo ? [photo] : []
  })
  const removedPhotos = layout.removed.flatMap(({ id, ...position }) => {
    const photo = catalog.get(id)
    return photo ? [{ photo, ...position }] : []
  })
  const activePhotoId = state.activePhotoId !== other.activePhotoId && photos.some(({ id }) => id === state.activePhotoId)
    ? state.activePhotoId
    : photos.find(({ id }) => id === layout.activePhotoId)?.id ?? photos[0]?.id ?? null
  for (const photo of photos) catalog.delete(photo.id)
  for (const { photo } of removedPhotos) catalog.delete(photo.id)
  return {
    photos, removedPhotos, activePhotoId,
    history: pruneHistory({ ...history, detachedPhotos: Object.fromEntries(catalog) }, photos, removedPhotos),
    screen: photos.length === 0 ? 'welcome' : state.photos.length === 0 && state.screen === 'welcome' ? 'edit' : state.screen,
  }
}

function applyHistory(state: SessionState, action: 'undo' | 'redo'): Partial<SessionState> {
  const stateAfterEdit = closeFrameEdit(state)
  const { history } = stateAfterEdit
  const select = action === 'undo' ? selectUndoSeries : selectRedoSeries
  const seriesId = select(history, state.activePhotoId)
  if (seriesId === undefined) return stateAfterEdit
  const change = getSeries(history, seriesId)[action].at(-1)?.change
  if (!change) return stateAfterEdit
  const side = action === 'undo' ? 'before' : 'after'
  const nextHistory = moveHistoryEntry(history, seriesId, action)
  const editing = { frameEditActive: false, pendingEdit: null }
  if (change.kind === 'layout') {
    return { ...editing, ...applyLayout(state, nextHistory, change[side], change[side === 'before' ? 'after' : 'before']) }
  }
  if (change.kind === 'common') {
    return { ...editing, history: nextHistory, commonFrame: applyValues(state.commonFrame, change.values, side) }
  }
  return { ...editing, history: nextHistory, photos: state.photos.map((photo) => photo.id === change.photoId ? applyValues(photo, change.values, side) : photo) }
}

function effectiveChanges(changes: Partial<FrameSettings>, frame: FrameSettings): Partial<FrameSettings> {
  const adjusted = { ...changes }
  const left = changes.left ?? changes.right ?? frame.left
  if ((changes.linkSides ?? frame.linkSides) && (changes.linkSides || changes.left !== undefined || changes.right !== undefined)) {
    adjusted.left = left
    adjusted.right = left
  }
  const top = changes.top ?? changes.bottom ?? frame.top
  if ((changes.linkVertical ?? frame.linkVertical) && (changes.linkVertical || changes.top !== undefined || changes.bottom !== undefined)) {
    adjusted.top = top
    adjusted.bottom = top
  }
  return adjusted
}

function currentWorkspace(state: SessionState, updatedAt = Date.now()): SessionWorkspace {
  return {
    id: state.sessionId,
    photos: state.photos,
    removedPhotos: state.removedPhotos,
    activePhotoId: state.activePhotoId,
    editMode: state.editMode,
    filmstripOpen: state.filmstripOpen,
    commonFrame: state.commonFrame,
    history: getCommittedHistory(state),
    screen: state.screen === 'export' ? 'review' : state.screen === 'import' ? state.photos.length ? 'edit' : 'welcome' : state.screen,
    updatedAt,
  }
}

function workspaceState(workspace: SessionWorkspace, screen = workspace.screen) {
  return {
    sessionId: workspace.id,
    photos: workspace.photos,
    removedPhotos: workspace.removedPhotos,
    activePhotoId: workspace.activePhotoId,
    editMode: workspace.editMode,
    filmstripOpen: workspace.filmstripOpen,
    commonFrame: workspace.commonFrame,
    history: workspace.history,
    screen,
    frameEditActive: false,
    pendingEdit: null,
  }
}

function saveRecentDraft(state: SessionState) {
  if (state.activeRecentId === null) return state.recentSessions
  const existing = state.recentSessions.find(({ id }) => id === state.activeRecentId)
  const draft = currentWorkspace(state, existing?.updatedAt)
  return existing
    ? state.recentSessions.map((workspace) => workspace.id === draft.id ? draft : workspace)
    : [draft, ...state.recentSessions].slice(0, state.recentLimit)
}

function hasWorkspaceData(state: SessionState) {
  return state.photos.length > 0 || state.removedPhotos.length > 0 || state.history.common.redo.length > 0
}

function limitWorkspaceHistory(workspace: SessionWorkspace, limit: number): SessionWorkspace {
  const { history, photos, removedPhotos } = workspace
  return { ...workspace, history: pruneHistory(limitHistory(history, limit), photos, removedPhotos) }
}

export const useSessionStore = create<SessionState>((set, get) => ({
  ...freshWorkspace(),
  candidates: [],
  candidatesReordered: false,
  settingsOpen: false,
  recentSessions: [],
  parkedSession: null,
  activeRecentId: null,
  recentLimit: 3,
  undoLimit: 50,
  setScreen: (screen) => set((state) => ({ ...closeFrameEdit(state), screen })),
  setCandidates: (updater) => set((state) => ({ candidates: updater(state.candidates) })),
  addCandidates: (incoming) => set((state) => {
    const keys = photoKeys(state)
    state.candidates.forEach((candidate) => keys.add(candidateKey(candidate)))
    const fresh = incoming.filter((candidate) => {
      const key = candidateKey(candidate)
      if (keys.has(key)) {
        releaseCandidate(candidate)
        return false
      }
      keys.add(key)
      return true
    })
    const byName = (a: ImportCandidate, b: ImportCandidate) => a.name.localeCompare(b.name, undefined, { numeric: true })
    const candidates = state.candidatesReordered ? [...state.candidates, ...fresh.sort(byName)] : [...state.candidates, ...fresh].sort(byName)
    return { candidates }
  }),
  selectAllCandidates: (selected) => set((state) => ({ candidates: state.candidates.map((candidate) => ({ ...candidate, selected })) })),
  removeCandidate: (id) => set((state) => {
    const removed = state.candidates.find((candidate) => candidate.id === id)
    if (!removed) return state
    releaseCandidate(removed)
    return { candidates: state.candidates.filter((candidate) => candidate.id !== id) }
  }),
  reorderCandidates: (fromId, toId) => set((state) => {
    const candidates = moveItem(state.candidates, fromId, toId)
    return candidates === state.candidates ? state : { candidates, candidatesReordered: true }
  }),
  clearImport: () => set((state) => {
    state.candidates.forEach(releaseCandidate)
    return { candidates: [], candidatesReordered: false }
  }),
  importSelected: () => {
    const staged = get().candidates
    const selected = staged.filter((candidate) => candidate.selected)
    if (!selected.length) return
    staged.filter((candidate) => !candidate.selected).forEach(releaseCandidate)
    get().addToSession(selected)
    set((state) => ({ candidates: [], candidatesReordered: false, screen: state.photos.length ? 'edit' : 'welcome' }))
  },
  setCandidateMetadata: (id, metadata, metadataState, expectedSource) => set((state) => {
    const matches = (candidate: ImportCandidate) => expectedSource ? candidate.source === expectedSource : candidate.id === id
    const metadataReaderVersion = metadataState === 'fileError' ? 0 : PHOTO_METADATA_READER_VERSION
    const candidates = state.candidates.some(matches)
      ? state.candidates.map((candidate) => matches(candidate) ? { ...candidate, metadata, metadataState, metadataReaderVersion } : candidate)
      : state.candidates
    const update = (photo: SessionPhoto) => matches(photo) ? { ...photo, metadata, metadataState, metadataReaderVersion } : photo
    const updateWorkspace = <T extends Pick<SessionWorkspace, 'photos' | 'removedPhotos' | 'history'>>(workspace: T): T => {
      const matchingPhoto = workspace.photos.some(matches)
      const matchingRemoval = workspace.removedPhotos.some(({ photo }) => matches(photo))
      const detached = Object.values(workspace.history.detachedPhotos).find(matches)
      if (!matchingPhoto && !matchingRemoval && !detached) return workspace
      return {
        ...workspace,
        photos: matchingPhoto ? workspace.photos.map(update) : workspace.photos,
        removedPhotos: matchingRemoval ? workspace.removedPhotos.map((removed) => ({ ...removed, photo: update(removed.photo) })) : workspace.removedPhotos,
        history: detached ? { ...workspace.history, detachedPhotos: { ...workspace.history.detachedPhotos, [detached.id]: update(detached) } } : workspace.history,
      }
    }
    const updates = updateWorkspace({ photos: state.photos, removedPhotos: state.removedPhotos, history: state.history })
    const recentSessions = state.recentSessions.map(updateWorkspace)
    return {
      ...updates, candidates,
      parkedSession: state.parkedSession && updateWorkspace(state.parkedSession),
      recentSessions: recentSessions.some((session, index) => session !== state.recentSessions[index]) ? recentSessions : state.recentSessions,
    }
  }),
  setActivePhoto: (id) => set((state) => state.photos.some((photo) => photo.id === id)
    ? { ...closeFrameEdit(state), activePhotoId: id }
    : state),
  setEditMode: (editMode) => set((state) => ({ ...closeFrameEdit(state), editMode })),
  updateFrame: (key, value) => get().patchFrame({ [key]: value }),
  patchFrame: (changes) => set((state) => {
    const photo = state.photos.find(({ id }) => id === state.activePhotoId)
    if (state.editMode === 'this' && photo) {
      const adjusted = effectiveChanges(changes, getEffectiveFrame(photo, state.commonFrame))
      return changePhoto(state, photo.id, (current) => ({ ...current, overrides: { ...current.overrides, ...adjusted } }))
    }
    const commonFrame = { ...state.commonFrame, ...effectiveChanges(changes, state.commonFrame) }
    const values = changedValues(state.commonFrame, commonFrame)
    return values.keys.length ? { commonFrame, ...recordChange(state, { kind: 'common', values }) } : state
  }),
  resetPhotoOverride: (id, key) => set((state) => changePhoto(state, id, (photo) => {
    if (!Object.hasOwn(photo.overrides, key)) return photo
    const overrides = { ...photo.overrides }
    delete overrides[key]
    return { ...photo, overrides }
  })),
  resetPhotoOverrides: (id) => set((state) => changePhoto(state, id, (photo) => ({ ...photo, overrides: {} }))),
  setPhotoMetadataOverrides: (id, patch) => set((state) => changePhoto(state, id, (photo) => {
    const metadataOverrides = { ...photo.metadataOverrides, ...patch }
    for (const key of Object.keys(metadataOverrides) as (keyof PhotoMetadata)[]) {
      if (metadataOverrides[key] === undefined) delete metadataOverrides[key]
    }
    return { ...photo, metadataOverrides: Object.keys(metadataOverrides).length ? metadataOverrides : undefined }
  })),
  setCompleted: (id, completed) => set((state) => changePhoto(state, id, (photo) => ({ ...photo, completed }))),
  doneNext: () => set((state) => {
    const index = state.photos.findIndex((photo) => photo.id === state.activePhotoId)
    if (index === -1) return state
    const frameEdit = closeFrameEdit(state)
    const closed = { ...state, ...frameEdit }
    const photo = closed.photos[index]
    const changes = changePhoto(closed, photo.id, (current) => ({ ...current, completed: true }))
    const nextPhoto = closed.photos[index + 1]
    return { ...frameEdit, ...changes, activePhotoId: nextPhoto?.id ?? photo.id, screen: nextPhoto ? 'edit' : 'review' }
  }),
  toggleFilmstrip: () => set((state) => ({ filmstripOpen: !state.filmstripOpen })),
  toggleSettings: () => set((state) => ({ ...closeFrameEdit(state), settingsOpen: !state.settingsOpen })),
  addToSession: (incoming) => set((state) => {
    const keys = photoKeys(state)
    const ids = new Set([...state.photos, ...state.removedPhotos.map(({ photo }) => photo), ...Object.values(state.history.detachedPhotos)].map(({ id }) => id))
    const fresh: SessionPhoto[] = []
    for (const candidate of incoming) {
      const key = candidateKey(candidate)
      if (keys.has(key)) {
        releaseCandidate(candidate)
        continue
      }
      keys.add(key)
      const id = ids.has(candidate.id) ? crypto.randomUUID() : candidate.id
      ids.add(id)
      fresh.push({ ...candidate, id, completed: false, overrides: {} })
    }
    if (!fresh.length) return state
    return changeLayout(state, [...state.photos, ...fresh], state.removedPhotos, state.activePhotoId ?? fresh[0].id)
  }),
  reorderPhotos: (fromId, toId) => set((state) => {
    const photos = moveItem(state.photos, fromId, toId)
    return photos === state.photos ? state : changeLayout(state, photos, state.removedPhotos, state.activePhotoId)
  }),
  removePhoto: (id) => set((state) => {
    const index = state.photos.findIndex((photo) => photo.id === id)
    if (index === -1) return state
    const photos = state.photos.filter((photo) => photo.id !== id)
    const activePhotoId = state.activePhotoId === id ? photos[Math.min(index, photos.length - 1)]?.id ?? null : state.activePhotoId
    const removed = {
      photo: state.photos[index], index,
      previousPhotoId: state.photos[index - 1]?.id,
      nextPhotoId: state.photos[index + 1]?.id,
    }
    return changeLayout(state, photos, [...state.removedPhotos, removed], activePhotoId)
  }),
  restorePhoto: (id) => set((state) => {
    const removed = state.removedPhotos.find(({ photo }) => photo.id === id)
    if (!removed) return state
    const photos = [...state.photos]
    const before = photos.findIndex((photo) => photo.id === removed.nextPhotoId)
    const after = photos.findIndex((photo) => photo.id === removed.previousPhotoId)
    const index = before >= 0 ? before : after >= 0 ? after + 1 : removed.index
    photos.splice(index, 0, removed.photo)
    const changes = changeLayout(state, photos, state.removedPhotos.filter(({ photo }) => photo.id !== id), state.activePhotoId ?? id)
    return { ...changes, screen: state.photos.length === 0 ? 'edit' : changes.screen }
  }),
  relinkPhoto: (id, source) => {
    const state = get()
    const existing = state.photos.find((photo) => photo.id === id)
    if (!existing) return false
    const nextKey = candidateKey({ name: existing.name, source })
    const others = [...state.photos, ...state.removedPhotos.map(({ photo }) => photo)]
    if (others.some((photo) => photo.id !== id && candidateKey(photo) === nextKey)) return false
    set((current) => changePhoto(current, id, (photo) => ({ ...photo, source })))
    return true
  },
  markPhotoSourceMissing: (id, source) => set((state) => {
    const photo = state.photos.find((candidate) => candidate.id === id)
    if (!photo || photo.source !== source || photo.source.kind !== 'path' || photo.source.missing) return state
    const missingSource: PhotoSource = { ...photo.source, url: '', missing: true }
    return { photos: state.photos.map((candidate) => candidate === photo ? { ...candidate, source: missingSource } : candidate) }
  }),
  nextPhoto: () => {
    const { photos, activePhotoId, setActivePhoto } = get()
    const index = photos.findIndex((photo) => photo.id === activePhotoId)
    if (index >= 0 && index < photos.length - 1) setActivePhoto(photos[index + 1].id)
  },
  previousPhoto: () => {
    const { photos, activePhotoId, setActivePhoto } = get()
    const index = photos.findIndex((photo) => photo.id === activePhotoId)
    if (index > 0) setActivePhoto(photos[index - 1].id)
  },
  beginFrameEdit: () => set((state) => state.frameEditActive ? state : { frameEditActive: true }),
  endFrameEdit: () => set((state) => state.frameEditActive ? closeFrameEdit(state) : state),
  undo: () => set((state) => applyHistory(state, 'undo')),
  redo: () => set((state) => applyHistory(state, 'redo')),
  setUndoLimit: (limit) => set((state) => {
    const undoLimit = [25, 50, 100, 200].includes(limit) ? limit : 50
    if (undoLimit === state.undoLimit) return state
    const trim = (workspace: SessionWorkspace) => limitWorkspaceHistory(workspace, undoLimit)
    return {
      ...closeFrameEdit(state),
      undoLimit,
      history: trim(currentWorkspace(state)).history,
      recentSessions: state.recentSessions.map(trim),
      parkedSession: state.parkedSession && trim(state.parkedSession),
    }
  }),
  setRecentLimit: (limit) => set((state) => {
    const recentLimit = Number.isFinite(limit) ? Math.min(30, Math.max(1, Math.round(limit))) : 3
    return { recentLimit, recentSessions: state.recentSessions.slice(0, recentLimit) }
  }),
  finishSession: () => set((state) => {
    if (!state.photos.length) return state
    const active = currentWorkspace(state)
    const finished: SessionWorkspace = {
      ...active,
      removedPhotos: [],
      history: clearRemovedHistory(active.history, active.removedPhotos, active.photos),
      screen: 'edit',
    }
    const recentSessions = [finished, ...state.recentSessions.filter((workspace) => workspace.id !== finished.id)].slice(0, state.recentLimit)
    const workspace = state.parkedSession ? workspaceState(state.parkedSession, 'welcome') : freshWorkspace()
    state.candidates.forEach(releaseCandidate)
    return { ...workspace, candidates: [], candidatesReordered: false, activeRecentId: null, parkedSession: null, recentSessions }
  }),
  openRecentSession: (id) => set((state) => {
    if (id === state.activeRecentId) return { ...closeFrameEdit(state), screen: state.photos.length ? 'edit' : 'welcome' }
    const recent = state.recentSessions.find((workspace) => workspace.id === id)
    if (!recent) return state
    const parkedSession = state.activeRecentId === null && hasWorkspaceData(state) ? currentWorkspace(state) : state.parkedSession
    state.candidates.forEach(releaseCandidate)
    return { ...workspaceState(recent, recent.photos.length ? 'edit' : 'welcome'), candidates: [], candidatesReordered: false, activeRecentId: id, parkedSession, recentSessions: saveRecentDraft(state) }
  }),
  resumeCurrentSession: () => set((state) => {
    if (state.activeRecentId === null) return { ...closeFrameEdit(state), screen: state.photos.length ? 'edit' : 'welcome' }
    const workspace = state.parkedSession ? workspaceState(state.parkedSession, state.parkedSession.photos.length ? 'edit' : 'welcome') : freshWorkspace()
    state.candidates.forEach(releaseCandidate)
    return { ...workspace, candidates: [], candidatesReordered: false, activeRecentId: null, parkedSession: null, recentSessions: saveRecentDraft(state) }
  }),
}))

export const getEffectiveFrame = (photo: SessionPhoto | undefined, common: FrameSettings): FrameSettings => ({
  ...common,
  ...(photo?.overrides ?? {}),
})

export function canUndo(state: SessionState) {
  return selectUndoSeries(getCommittedHistory(state), state.activePhotoId) !== undefined
}

export function canRedo(state: SessionState) {
  return selectRedoSeries(getCommittedHistory(state), state.activePhotoId) !== undefined
}

export function getSessionSnapshot(state = useSessionStore.getState()): SessionSnapshot {
  return {
    version: 2,
    active: serializeWorkspace(currentWorkspace(state)),
    parked: state.parkedSession && serializeWorkspace(state.parkedSession),
    recent: state.recentSessions.map(serializeWorkspace).filter((workspace) => (
      workspace.photos.length > 0 || workspace.removedPhotos.length > 0 || Object.keys(workspace.history.detachedPhotos).length > 0
    )),
    activeRecentId: state.activeRecentId,
  }
}

export function restoreSessionSnapshot(snapshot: SessionSnapshot, missingPaths: string[] = []) {
  if (snapshot.version !== 1 && snapshot.version !== 2) return
  const missing = new Set(missingPaths)
  const { undoLimit, recentLimit } = useSessionStore.getState()
  const restore = (workspace: SessionSnapshot['active']) => limitWorkspaceHistory(deserializeWorkspace(snapshot.version === 1 ? migrateLegacyWhite(workspace) : workspace, initialFrame, missing), undoLimit)
  const active = restore(snapshot.active)
  useSessionStore.setState({
    ...workspaceState(active),
    activeRecentId: snapshot.activeRecentId,
    parkedSession: snapshot.parked && restore(snapshot.parked),
    recentSessions: snapshot.recent.slice(0, recentLimit).map(restore),
    candidates: [],
    candidatesReordered: false,
  })
}
