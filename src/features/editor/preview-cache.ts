import { useEffect, useState } from 'react'
import type { PhotoRaster } from './frame-paint'

export const EDIT_PREVIEW_EDGE = 2048
export const PREVIEW_CACHE_LIMIT = 128 * 1024 * 1024
const MAX_CONCURRENT = 2
const DECODE_TIMEOUT_MS = 20_000
type Entry = { key: string; raster: PhotoRaster; bytes: number }
type Job = { key: string; url: string; edge: number; priority: number; order: number; status: 'queued' | 'running'; controller: AbortController; consumers: Set<symbol>; promise: Promise<PhotoRaster>; resolve: (r: PhotoRaster) => void; reject: (e: unknown) => void }
const cache = new Map<string, Entry>(), jobs = new Map<string, Job>(), queue: Job[] = []
let bytes = 0, running = 0, order = 0
const keyOf = (url: string, edge: number) => `${url}\u0000${edge}`
const abortError = () => new DOMException('Preview request cancelled', 'AbortError')

export function previewNeighborIndices(count: number, activeIndex: number, radius = 2) {
  if (count <= 0 || activeIndex < 0 || activeIndex >= count) return []
  const result: number[] = []
  for (let distance = 1; distance <= radius; distance++) {
    if (activeIndex - distance >= 0) result.push(activeIndex - distance)
    if (activeIndex + distance < count) result.push(activeIndex + distance)
  }
  return result
}

async function decode(url: string, edge: number, signal: AbortSignal): Promise<PhotoRaster> {
  const image = new Image(); image.crossOrigin = 'anonymous'
  const abort = () => image.removeAttribute('src')
  let rejectAbort!: (error: unknown) => void
  const aborted = new Promise<never>((_, reject) => { rejectAbort = reject })
  let timeoutId: ReturnType<typeof setTimeout>
  const timedOut = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error('Preview image decoding timed out.')), DECODE_TIMEOUT_MS)
  })
  const abortDecode = () => { abort(); rejectAbort(abortError()) }
  signal.addEventListener('abort', abortDecode, { once: true }); image.src = url
  try {
    await Promise.race([image.decode(), aborted, timedOut])
    if (signal.aborted) throw abortError()
    const scale = Math.min(1, edge / Math.max(image.naturalWidth, image.naturalHeight))
    const width = Math.max(1, Math.round(image.naturalWidth * scale)), height = Math.max(1, Math.round(image.naturalHeight * scale))
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height
    const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('Canvas is unavailable')
    ctx.imageSmoothingQuality = 'high'; ctx.drawImage(image, 0, 0, width, height)
    return { image: canvas, width, height }
  } finally { clearTimeout(timeoutId!); signal.removeEventListener('abort', abortDecode); image.removeAttribute('src') }
}
function cacheRaster(key: string, raster: PhotoRaster) {
  const size = raster.width * raster.height * 4, old = cache.get(key)
  if (old) bytes -= old.bytes
  cache.delete(key); cache.set(key, { key, raster, bytes: size }); bytes += size
  while (bytes > PREVIEW_CACHE_LIMIT && cache.size > 1) {
    const first = cache.entries().next().value as [string, Entry] | undefined
    if (!first) break
    cache.delete(first[0]); bytes -= first[1].bytes
  }
}
function removeQueued(job: Job, error: unknown) {
  const i = queue.indexOf(job); if (i >= 0) queue.splice(i, 1)
  if (jobs.get(job.key) === job) jobs.delete(job.key)
  job.reject(error)
}
function drain() {
  while (running < MAX_CONCURRENT && queue.length) {
    const job = queue.shift()!
    if (!job.consumers.size) { removeQueued(job, abortError()); continue }
    job.status = 'running'; running++
    void decode(job.url, job.edge, job.controller.signal).then(raster => { cacheRaster(job.key, raster); job.resolve(raster) }).catch(job.reject).finally(() => {
      if (jobs.get(job.key) === job) jobs.delete(job.key)
      running--; drain()
    })
  }
}
export function loadEditPreview(url: string, edge = EDIT_PREVIEW_EDGE, signal?: AbortSignal, priority = 0): Promise<PhotoRaster> {
  const key = keyOf(url, edge), hit = cache.get(key)
  if (hit) { cache.delete(key); cache.set(key, hit); return Promise.resolve(hit.raster) }
  if (signal?.aborted) return Promise.reject(abortError())
  let job = jobs.get(key)
  if (!job) {
    let resolve!: Job['resolve'], reject!: Job['reject']
    const promise = new Promise<PhotoRaster>((res, rej) => { resolve = res; reject = rej })
    job = { key, url, edge, priority, order: order++, status: 'queued', controller: new AbortController(), consumers: new Set(), promise, resolve, reject }
    jobs.set(key, job); queue.push(job)
  }
  const current = job, token = Symbol(key); current.consumers.add(token); current.priority = Math.max(current.priority, priority)
  const release = () => {
    current.consumers.delete(token)
    if (current.consumers.size) return
    if (current.status === 'queued') removeQueued(current, abortError())
    else { current.controller.abort(); if (jobs.get(key) === current) jobs.delete(key) }
  }
  signal?.addEventListener('abort', release, { once: true })
  if (current.status === 'queued') queue.sort((a, b) => b.priority - a.priority || a.order - b.order)
  drain()
  return current.promise.finally(() => signal?.removeEventListener('abort', release))
}
export function prefetchEditPreview(url: string, signal: AbortSignal, priority = 0) {
  return loadEditPreview(url, EDIT_PREVIEW_EDGE, signal, priority)
}
export function editPreviewCacheStats() { return { entries: cache.size, bytes, pending: queue.length, running } }

export function useEditPreview(url: string | undefined, enabled = true, retryKey = 0) {
  const [state, setState] = useState<{ url: string; raster?: PhotoRaster; error?: true }>()
  useEffect(() => {
    if (!url || !enabled) { setState(undefined); return }
    let active = true
    const controller = new AbortController()
    setState(undefined)
    void loadEditPreview(url, EDIT_PREVIEW_EDGE, controller.signal, 100).then(raster => { if (active) setState({ url, raster }) }).catch(error => {
      if (active && !(error instanceof DOMException && error.name === 'AbortError')) setState({ url, error: true })
    })
    return () => { active = false; controller.abort() }
  }, [enabled, retryKey, url])
  return state?.url === url ? state : undefined
}
