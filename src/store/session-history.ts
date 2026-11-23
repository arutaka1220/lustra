import type { FrameSettings, SessionPhoto } from '../types/photo'

type RemovedPosition = {
  index: number
  previousPhotoId?: string
  nextPhotoId?: string
}

export type RemovedPhoto<P = SessionPhoto> = RemovedPosition & { photo: P }

export type PhotoEdit<Source = SessionPhoto['source']> = Pick<SessionPhoto, 'overrides' | 'completed' | 'metadataOverrides' | 'cropTransform'> & {
  source: Source
}

export type ValueChange<T> = {
  keys: (keyof T)[]
  before: Partial<T>
  after: Partial<T>
}

export type SessionLayout = {
  photoIds: string[]
  removed: (RemovedPosition & { id: string })[]
  activePhotoId: string | null
}

export type SessionChange<Source = SessionPhoto['source']> =
  | { kind: 'common'; values: ValueChange<FrameSettings> }
  | { kind: 'photo'; photoId: string; values: ValueChange<PhotoEdit<Source>> }
  | { kind: 'photoBatch'; values: Record<string, ValueChange<PhotoEdit<Source>>> }
  | { kind: 'layout'; before: SessionLayout; after: SessionLayout }

export type HistoryEntry<Source = SessionPhoto['source']> = {
  change: SessionChange<Source>
  sequence: number
  undoneAt?: number
}

type HistorySeries<Source> = {
  undo: HistoryEntry<Source>[]
  redo: HistoryEntry<Source>[]
}

export type SessionHistory<P = SessionPhoto, Source = SessionPhoto['source']> = {
  common: HistorySeries<Source>
  photos: Record<string, HistorySeries<Source>>
  detachedPhotos: Record<string, P>
  sequence: number
}

export const emptyHistory: SessionHistory = {
  common: { undo: [], redo: [] },
  photos: {},
  detachedPhotos: {},
  sequence: 0,
}

const emptySeries: HistorySeries<SessionPhoto['source']> = { undo: [], redo: [] }

function equivalent(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false
  if ('kind' in left || 'kind' in right) return false
  if (Array.isArray(left) || Array.isArray(right)) return false
  const before = left as Record<string, unknown>
  const after = right as Record<string, unknown>
  const keys = Object.keys(before)
  return keys.length === Object.keys(after).length && keys.every((key) => Object.is(before[key], after[key]))
}

export function changedValues<T extends object>(before: Partial<T>, after: Partial<T>): ValueChange<T> {
  const change: ValueChange<T> = { keys: [], before: {}, after: {} }
  const keys = new Set([...Object.keys(before), ...Object.keys(after)] as (keyof T)[])
  for (const key of keys) {
    if (equivalent(before[key], after[key])) continue
    change.keys.push(key)
    if (Object.hasOwn(before, key)) change.before[key] = before[key]
    if (Object.hasOwn(after, key)) change.after[key] = after[key]
  }
  return change
}

export function applyValues<T, V extends T>(value: V, change: ValueChange<T>, side: 'before' | 'after'): V {
  const result = { ...value }
  const edited: T = result
  for (const key of change.keys) {
    if (Object.hasOwn(change[side], key)) edited[key] = change[side][key] as T[typeof key]
    else delete edited[key]
  }
  return result
}

function mergeValues<T>(previous: ValueChange<T>, next: ValueChange<T>): ValueChange<T> {
  const keys = new Set([...previous.keys, ...next.keys])
  const merged: ValueChange<T> = { keys: [], before: {}, after: {} }
  for (const key of keys) {
    const before = previous.keys.includes(key) ? previous.before : next.before
    const after = next.keys.includes(key) ? next.after : previous.after
    if (equivalent(before[key], after[key])) continue
    merged.keys.push(key)
    if (Object.hasOwn(before, key)) merged.before[key] = before[key]
    if (Object.hasOwn(after, key)) merged.after[key] = after[key]
  }
  return merged
}

export function mergeChanges(previous: SessionChange, next: SessionChange): SessionChange | null {
  if (previous.kind === 'common' && next.kind === 'common') {
    return { kind: 'common', values: mergeValues(previous.values, next.values) }
  }
  if (previous.kind === 'photo' && next.kind === 'photo' && previous.photoId === next.photoId) {
    return { kind: 'photo', photoId: next.photoId, values: mergeValues(previous.values, next.values) }
  }
  if (previous.kind === 'photoBatch' && next.kind === 'photoBatch') {
    const values = { ...previous.values }
    for (const [id, change] of Object.entries(next.values)) {
      values[id] = values[id] ? mergeValues(values[id], change) : change
    }
    return { kind: 'photoBatch', values }
  }
  return null
}

export function getSeries(history: SessionHistory, photoId: string | null): HistorySeries<SessionPhoto['source']> {
  return photoId === null ? history.common : history.photos[photoId] ?? emptySeries
}

function setSeries(history: SessionHistory, photoId: string | null, series: HistorySeries<SessionPhoto['source']>): SessionHistory {
  return photoId === null
    ? { ...history, common: series }
    : { ...history, photos: { ...history.photos, [photoId]: series } }
}

export function appendChange(history: SessionHistory, change: SessionChange, limit: number): SessionHistory {
  if (change.kind !== 'layout' && !(change.kind === 'photoBatch' ? Object.values(change.values).some((value) => value.keys.length) : change.values.keys.length)) return history
  const photoId = change.kind === 'photo' ? change.photoId : null
  const series = getSeries(history, photoId)
  const sequence = history.sequence + 1
  return setSeries({ ...history, sequence }, photoId, {
    undo: [...series.undo, { change, sequence }].slice(-limit),
    redo: [],
  })
}

export function selectUndoSeries(history: SessionHistory, activePhotoId: string | null): string | null | undefined {
  const common = history.common.undo.at(-1)
  const current = activePhotoId === null ? undefined : history.photos[activePhotoId]?.undo.at(-1)
  if (common?.change.kind === 'layout') {
    const isLatest = Object.values(history.photos).every((series) => (series.undo.at(-1)?.sequence ?? 0) < common.sequence)
    if (isLatest) return null
  }
  if (current) return activePhotoId
  if (common) return null
  return undefined
}

export function selectRedoSeries(history: SessionHistory, activePhotoId: string | null): string | null | undefined {
  const common = history.common.redo.at(-1)
  const current = activePhotoId === null ? undefined : history.photos[activePhotoId]?.redo.at(-1)
  if (common && (!current || (common.undoneAt ?? 0) > (current.undoneAt ?? 0))) return null
  if (current) return activePhotoId
  return undefined
}

export function moveHistoryEntry(history: SessionHistory, photoId: string | null, action: 'undo' | 'redo'): SessionHistory {
  const series = getSeries(history, photoId)
  const entry = series[action].at(-1)
  if (!entry) return history
  const sequence = history.sequence + 1
  return setSeries({ ...history, sequence }, photoId, action === 'undo' ? {
    undo: series.undo.slice(0, -1),
    redo: [...series.redo, { ...entry, undoneAt: sequence }],
  } : {
    undo: [...series.undo, { change: entry.change, sequence }],
    redo: series.redo.slice(0, -1),
  })
}

export function pruneHistory(history: SessionHistory, photos: readonly SessionPhoto[], removed: readonly RemovedPhoto[]): SessionHistory {
  const retainedIds = new Set<string>()
  for (const { change } of [...history.common.undo, ...history.common.redo]) {
    if (change.kind === 'layout') {
      for (const layout of [change.before, change.after]) {
        layout.photoIds.forEach((id) => retainedIds.add(id))
        layout.removed.forEach(({ id }) => retainedIds.add(id))
      }
    }
  }
  photos.forEach(({ id }) => retainedIds.add(id))
  removed.forEach(({ photo }) => retainedIds.add(photo.id))
  const detached = Object.entries(history.detachedPhotos).filter(([id]) => retainedIds.has(id))
  const photoSeries = Object.entries(history.photos).filter(([id]) => retainedIds.has(id))
  if (detached.length === Object.keys(history.detachedPhotos).length && photoSeries.length === Object.keys(history.photos).length) return history
  return { ...history, detachedPhotos: Object.fromEntries(detached), photos: Object.fromEntries(photoSeries) }
}

export function limitHistory(history: SessionHistory, limit: number): SessionHistory {
  const trim = (series: HistorySeries<SessionPhoto['source']>) => {
    const undo = series.undo.slice(-limit)
    const redoLimit = limit - undo.length
    return { undo, redo: redoLimit > 0 ? series.redo.slice(-redoLimit) : [] }
  }
  return {
    ...history,
    common: trim(history.common),
    photos: Object.fromEntries(Object.entries(history.photos).map(([id, series]) => [id, trim(series)])),
  }
}

export function sessionLayout(photos: SessionPhoto[], removedPhotos: RemovedPhoto[], activePhotoId: string | null): SessionLayout {
  return {
    photoIds: photos.map((photo) => photo.id),
    removed: removedPhotos.map(({ photo, ...position }) => ({ id: photo.id, ...position })),
    activePhotoId,
  }
}

export function clearRemovedHistory(history: SessionHistory, removedPhotos: RemovedPhoto[], photos: SessionPhoto[]): SessionHistory {
  const clearRemoved = (entry: HistoryEntry): HistoryEntry => {
    const change = entry.change
    if (change.kind !== 'layout') return entry
    return { ...entry, change: { ...change, before: { ...change.before, removed: [] }, after: { ...change.after, removed: [] } } }
  }
  return pruneHistory({
    ...history,
    common: { undo: history.common.undo.map(clearRemoved), redo: history.common.redo.map(clearRemoved) },
    detachedPhotos: { ...history.detachedPhotos, ...Object.fromEntries(removedPhotos.map(({ photo }) => [photo.id, photo])) },
  }, photos, [])
}
