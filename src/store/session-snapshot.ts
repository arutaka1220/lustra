import { convertFileSrc, isTauri } from '@tauri-apps/api/core'
import { PHOTO_METADATA_READER_VERSION } from '../types/photo'
import type { FrameSettings, PhotoSource, SessionPhoto } from '../types/photo'
import { withoutLegacyCanvasSettings, withoutLegacyCrop } from '../features/editor/frame-migration'
import type { HistoryEntry, PhotoEdit, RemovedPhoto, SessionChange, SessionHistory, SessionLayout } from './session-history'

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

export const SESSION_SNAPSHOT_VERSION = 3 as const

export type SessionSnapshot = {
  version: number
  active: StoredWorkspace
  parked: StoredWorkspace | null
  suspended?: StoredWorkspace[]
  recent: StoredWorkspace[]
  activeRecentId: string | null
}

export function assertSupportedSessionSnapshot(snapshot: SessionSnapshot): void {
  if (!snapshot || typeof snapshot !== 'object' || !Number.isInteger(snapshot.version)) {
    throw new Error('This session archive is invalid or damaged.')
  }
  if (snapshot.version > SESSION_SNAPSHOT_VERSION) {
    throw new Error('This session archive requires a newer version of Lustra.')
  }
  if (snapshot.version < 1) {
    throw new Error('This session archive is invalid or damaged.')
  }
}

function migrateLegacyWhite(workspace: StoredWorkspace): StoredWorkspace {
  const frame = (value: any) => value && value.style === 'white' ? { ...value, style: 'softWhite' } : value
  const photo = (value: any) => value && ({ ...value, overrides: frame(value.overrides) })
  const series = (value: any, kind: 'common' | 'photo') => value && Object.fromEntries(['undo', 'redo'].map(direction => [direction, (value[direction] ?? []).map((entry: any) => {
    const change = entry.change
    if (change?.kind === kind) {
      if (kind === 'common') return { ...entry, change: { ...change, values: { ...change.values, before: frame(change.values.before), after: frame(change.values.after) } } }
      const edit = (v: any) => v?.overrides ? { ...v, overrides: frame(v.overrides) } : v
      return { ...entry, change: { ...change, values: { ...change.values, before: edit(change.values.before), after: edit(change.values.after) } } }
    }
    return entry
  })]))
  return {
    ...workspace,
    commonFrame: frame(workspace.commonFrame),
    photos: workspace.photos.map(photo),
    removedPhotos: workspace.removedPhotos.map((v: any) => ({ ...v, photo: photo(v.photo) })),
    history: {
      ...workspace.history,
      detachedPhotos: Object.fromEntries(Object.entries(workspace.history.detachedPhotos).map(([id, v]) => [id, photo(v)])),
      common: series(workspace.history.common, 'common'),
      photos: Object.fromEntries(Object.entries(workspace.history.photos).map(([id, v]) => [id, series(v, 'photo')])),
    },
  }
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
  const normalizePhoto = (photo: StoredPhoto): StoredPhoto => {
    const withoutCrop = withoutLegacyCrop(photo)
    const canReadSource = !missingPaths.has(photo.source.path)
    const metadataIsStale = canReadSource && (photo.metadataReaderVersion !== PHOTO_METADATA_READER_VERSION || !photo.imageWidth || !photo.imageHeight)
    return {
      ...withoutCrop,
      metadataState: metadataIsStale ? 'loading' : photo.metadataState,
      overrides: withoutLegacyCanvasSettings(photo.overrides),
    } as StoredPhoto
  }
  const restorePhoto = (photo: StoredPhoto): SessionPhoto => ({ ...normalizePhoto(photo), source: restoreSource(photo.source) })
  const restorePhotoEdit = (value: Partial<PhotoEdit<StoredSource>>): Partial<PhotoEdit> => {
    const withoutCrop = withoutLegacyCrop(value) as Partial<PhotoEdit<StoredSource>> & { overrides?: Record<string, unknown> }
    const normalized = withoutCrop.overrides
      ? { ...withoutCrop, overrides: withoutLegacyCanvasSettings(withoutCrop.overrides) as Partial<FrameSettings> }
      : withoutCrop
    const { source, ...rest } = normalized
    return source ? { ...rest, source: restoreSource(source) } : rest
  }
  const restorePhotoChange = (change: Extract<SessionChange<StoredSource>, { kind: 'photo' }>) => {
    const keys = change.values.keys.filter((key) => String(key) !== 'crop')
    if (!keys.length) return null
    const before = restorePhotoEdit(change.values.before)
    const after = restorePhotoEdit(change.values.after)
    if (JSON.stringify(before) === JSON.stringify(after)) return null
    return { ...change, values: { keys, before, after } }
  }
  const restoreCommonChange = (change: Extract<SessionChange<StoredSource>, { kind: 'common' }>) => {
    const removedKeys = new Set(['ratio', 'ratioWidth', 'ratioHeight', 'fit'])
    const keys = change.values.keys.filter((key) => !removedKeys.has(String(key)))
    if (!keys.length) return null
    const before = withoutLegacyCanvasSettings(change.values.before)
    const after = withoutLegacyCanvasSettings(change.values.after)
    return { ...change, values: { keys, before, after } }
  }
  const restoreEntry = (entry: HistoryEntry<StoredSource>): HistoryEntry | null => {
    const change = entry.change
    if (change.kind === 'photo') {
      const normalized = restorePhotoChange(change)
      return normalized ? { ...entry, change: normalized } : null
    }
    if (change.kind === 'common') {
      const normalized = restoreCommonChange(change)
      return normalized ? { ...entry, change: normalized } : null
    }
    return { ...entry, change }
  }
  const restoreSeries = ({ undo, redo }: StoredWorkspace['history']['common']) => ({
    undo: undo.flatMap((entry) => { const restored = restoreEntry(entry); return restored ? [restored] : [] }),
    redo: redo.flatMap((entry) => { const restored = restoreEntry(entry); return restored ? [restored] : [] }),
  })
  const normalizedFrame = withoutLegacyCanvasSettings(workspace.commonFrame)
  return {
    ...workspace,
    commonFrame: { ...initialFrame, ...normalizedFrame },
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

export { migrateLegacyWhite }
