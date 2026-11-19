import { convertFileSrc, isTauri } from '@tauri-apps/api/core'
import type { FrameSettings, PhotoSource, SessionPhoto } from '../types/photo'
import type { HistoryEntry, PhotoEdit, RemovedPhoto, SessionHistory, SessionLayout, ValueChange } from './session-history'

type StoredSource = { kind: 'path'; path: string }
type StoredPhoto = Omit<SessionPhoto, 'source'> & { source: StoredSource }

type Workspace<P, Source> = {
  id: string
  updatedAt: number
  photos: P[]
  removedPhotos: RemovedPhoto<P>[]
  activePhotoId: string | null
  commonFrame: FrameSettings
  editMode: 'all' | 'this'
  filmstripOpen: boolean
  screen: 'welcome' | 'edit' | 'review'
  history: SessionHistory<P, Source>
}

export type SessionWorkspace = Workspace<SessionPhoto, PhotoSource>
type StoredWorkspace = Workspace<StoredPhoto, StoredSource>

export type SessionSnapshot = {
  version: 1
  active: StoredWorkspace
  parked: StoredWorkspace | null
  recent: StoredWorkspace[]
  activeRecentId: string | null
}

function serializePhoto(photo: SessionPhoto): StoredPhoto | undefined {
  if (photo.source.kind !== 'path') return undefined
  return { ...photo, source: { kind: 'path', path: photo.source.path } }
}

function stableLayout(layout: SessionLayout, validIds: Set<string>): SessionLayout {
  const photoIds = layout.photoIds.filter((id) => validIds.has(id))
  return {
    photoIds,
    removed: layout.removed.filter(({ id }) => validIds.has(id)),
    activePhotoId: layout.activePhotoId && photoIds.includes(layout.activePhotoId) ? layout.activePhotoId : photoIds[0] ?? null,
  }
}

function serializeEntry(entry: HistoryEntry, validIds: Set<string>): HistoryEntry<StoredSource>[] {
  const { change } = entry
  if (change.kind === 'common') return [{ ...entry, change }]
  if (change.kind === 'layout') {
    const before = stableLayout(change.before, validIds)
    const after = stableLayout(change.after, validIds)
    if (JSON.stringify(before) === JSON.stringify(after)) return []
    return [{ ...entry, change: { kind: 'layout', before, after } }]
  }
  const format = ({ source, ...rest }: Partial<PhotoEdit>): Partial<PhotoEdit<StoredSource>> => (
    source?.kind === 'path' ? { ...rest, source: { kind: 'path', path: source.path } } : rest
  )
  const before = format(change.values.before)
  const after = format(change.values.after)
  const keys = before.source && after.source ? change.values.keys : change.values.keys.filter((key) => key !== 'source')
  return keys.length ? [{ ...entry, change: { ...change, values: { keys, before, after } } }] : []
}

export function serializeWorkspace(workspace: SessionWorkspace): StoredWorkspace {
  const photos = workspace.photos.flatMap((photo) => {
    const stored = serializePhoto(photo)
    return stored ? [stored] : []
  })
  const removedPhotos = workspace.removedPhotos.flatMap((removed) => {
    const photo = serializePhoto(removed.photo)
    return photo ? [{ ...removed, photo }] : []
  })
  const detachedPhotos = Object.fromEntries(Object.entries(workspace.history.detachedPhotos).flatMap(([id, photo]) => {
    const stored = serializePhoto(photo)
    return stored ? [[id, stored]] : []
  }))
  const validIds = new Set([...photos.map(({ id }) => id), ...removedPhotos.map(({ photo }) => photo.id), ...Object.keys(detachedPhotos)])
  const serialize = (entry: HistoryEntry) => serializeEntry(entry, validIds)
  const serializeSeries = ({ undo, redo }: SessionHistory['common']) => ({ undo: undo.flatMap(serialize), redo: redo.flatMap(serialize) })

  return {
    ...workspace,
    photos,
    removedPhotos,
    activePhotoId: photos.find(({ id }) => id === workspace.activePhotoId)?.id ?? photos[0]?.id ?? null,
    screen: photos.length ? workspace.screen : 'welcome',
    history: {
      ...workspace.history,
      detachedPhotos,
      common: serializeSeries(workspace.history.common),
      photos: Object.fromEntries(Object.entries(workspace.history.photos).filter(([id]) => validIds.has(id)).map(([id, series]) => [id, serializeSeries(series)])),
    },
  }
}

export function deserializeWorkspace(workspace: StoredWorkspace, initialFrame: FrameSettings, missingPaths: Set<string>): SessionWorkspace {
  const restoreSource = (source: StoredSource): PhotoSource => {
    const missing = missingPaths.has(source.path)
    return { ...source, missing, url: missing ? '' : isTauri() ? convertFileSrc(source.path) : source.path }
  }
  const restorePhoto = (photo: StoredPhoto): SessionPhoto => ({ ...photo, source: restoreSource(photo.source) })
  const restoreChange = ({ keys, before, after }: ValueChange<PhotoEdit<StoredSource>>): ValueChange<PhotoEdit> => {
    const format = ({ source, ...rest }: Partial<PhotoEdit<StoredSource>>): Partial<PhotoEdit> => source ? { ...rest, source: restoreSource(source) } : rest
    return { keys, before: format(before), after: format(after) }
  }
  const restoreEntry = (entry: HistoryEntry<StoredSource>): HistoryEntry => {
    const change = entry.change
    return change.kind === 'photo' ? { ...entry, change: { ...change, values: restoreChange(change.values) } } : { ...entry, change }
  }
  const restoreSeries = ({ undo, redo }: StoredWorkspace['history']['common']) => ({ undo: undo.map(restoreEntry), redo: redo.map(restoreEntry) })
  return {
    ...workspace,
    commonFrame: { ...initialFrame, ...workspace.commonFrame },
    photos: workspace.photos.map(restorePhoto),
    removedPhotos: workspace.removedPhotos.map((removed) => ({ ...removed, photo: restorePhoto(removed.photo) })),
    history: {
      ...workspace.history,
      detachedPhotos: Object.fromEntries(Object.entries(workspace.history.detachedPhotos).map(([id, photo]) => [id, restorePhoto(photo)])),
      common: restoreSeries(workspace.history.common),
      photos: Object.fromEntries(Object.entries(workspace.history.photos).map(([id, series]) => [id, restoreSeries(series)])),
    },
  }
}
