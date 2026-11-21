import { useEffect, useState } from 'react'
import type { PhotoRaster } from '../editor/frame-paint'

const THUMBNAIL_EDGE = 384
const CACHE_LIMIT_BYTES = 24 * 1024 * 1024
const MAX_CONCURRENT_DECODES = 2
const MAX_PENDING_THUMBNAILS = 48
const DECODE_TIMEOUT_MS = 20_000

type CacheEntry = { raster: PhotoRaster; bytes: number }
type QueueEntry = {
  url: string
  promise: Promise<PhotoRaster>
  resolve: (raster: PhotoRaster) => void
  reject: (error: unknown) => void
  controller: AbortController
  consumers: Set<symbol>
  status: 'queued' | 'running'
  priority: number
  order: number
}

const cache = new Map<string, CacheEntry>()
const jobs = new Map<string, QueueEntry>()
const queue: QueueEntry[] = []
let cacheBytes = 0
let activeDecodes = 0
let nextOrder = 0

function abortError() {
  return new DOMException('Thumbnail request is no longer visible.', 'AbortError')
}

function touch(key: string, entry: CacheEntry) {
  cache.delete(key)
  cache.set(key, entry)
}

function addToCache(key: string, raster: PhotoRaster) {
  const bytes = raster.width * raster.height * 4
  const previous = cache.get(key)
  if (previous) cacheBytes -= previous.bytes
  cache.delete(key)
  cache.set(key, { raster, bytes })
  cacheBytes += bytes
  while (cacheBytes > CACHE_LIMIT_BYTES && cache.size > 1) {
    const oldest = cache.entries().next().value as [string, CacheEntry] | undefined
    if (!oldest) break
    cache.delete(oldest[0])
    cacheBytes -= oldest[1].bytes
  }
}

async function decodeThumbnail(url: string, signal: AbortSignal): Promise<PhotoRaster> {
  const image = new Image()
  image.crossOrigin = 'anonymous'
  const abortImageLoad = () => image.removeAttribute('src')
  let rejectAbort!: (error: unknown) => void
  const aborted = new Promise<never>((_, reject) => { rejectAbort = reject })
  let timeoutId: ReturnType<typeof setTimeout>
  const timedOut = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error('Thumbnail image decoding timed out.')), DECODE_TIMEOUT_MS)
  })
  const abortDecode = () => { abortImageLoad(); rejectAbort(abortError()) }
  signal.addEventListener('abort', abortDecode, { once: true })
  image.src = url
  let bitmap: ImageBitmap | undefined
  let discardLateBitmap = false
  try {
    await Promise.race([image.decode(), aborted, timedOut])
    if (signal.aborted) throw abortError()
    const scale = Math.min(1, THUMBNAIL_EDGE / Math.max(image.naturalWidth, image.naturalHeight))
    const width = Math.max(1, Math.round(image.naturalWidth * scale))
    const height = Math.max(1, Math.round(image.naturalHeight * scale))
    const pendingBitmap = createImageBitmap(image, { resizeWidth: width, resizeHeight: height, resizeQuality: 'high' }).then((result) => {
      if (discardLateBitmap) result.close()
      return result
    })
    try {
      bitmap = await Promise.race([
        pendingBitmap,
        aborted,
        timedOut,
      ])
    } catch (error) {
      discardLateBitmap = true
      if (signal.aborted) throw error
      // Some WebViews can decode an image but reject createImageBitmap's resize overload.
      // The already-decoded image can still be drawn directly to the thumbnail canvas.
    }
    if (signal.aborted) throw abortError()
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas is unavailable')
    if (bitmap) {
      try {
        context.drawImage(bitmap, 0, 0, width, height)
      } catch {
        bitmap.close()
        bitmap = undefined
        context.drawImage(image, 0, 0, width, height)
      }
    } else {
      context.drawImage(image, 0, 0, width, height)
    }
    return { image: canvas, width, height }
  } finally {
    signal.removeEventListener('abort', abortDecode)
    clearTimeout(timeoutId!)
    image.removeAttribute('src')
    bitmap?.close()
  }
}

function removeQueuedJob(job: QueueEntry, error: unknown) {
  const index = queue.indexOf(job)
  if (index >= 0) queue.splice(index, 1)
  if (jobs.get(job.url) === job) jobs.delete(job.url)
  job.reject(error)
}

function drainQueue() {
  while (activeDecodes < MAX_CONCURRENT_DECODES && queue.length) {
    const item = queue.shift()
    if (!item) return
    if (item.consumers.size === 0) {
      removeQueuedJob(item, abortError())
      continue
    }
    item.status = 'running'
    activeDecodes += 1
    void decodeThumbnail(item.url, item.controller.signal).then((raster) => {
      addToCache(item.url, raster)
      item.resolve(raster)
    }).catch(item.reject).finally(() => {
      if (jobs.get(item.url) === item) jobs.delete(item.url)
      activeDecodes -= 1
      drainQueue()
    })
  }
}

export function loadPhotoThumbnail(url: string, signal?: AbortSignal, priority = 0): Promise<PhotoRaster> {
  const hit = cache.get(url)
  if (hit) {
    touch(url, hit)
    return Promise.resolve(hit.raster)
  }
  if (signal?.aborted) return Promise.reject(abortError())

  let job = jobs.get(url)
  if (!job) {
    let resolve!: (raster: PhotoRaster) => void
    let reject!: (error: unknown) => void
    const promise = new Promise<PhotoRaster>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise
      reject = rejectPromise
    })
    job = { url, promise, resolve, reject, controller: new AbortController(), consumers: new Set(), status: 'queued', priority, order: nextOrder++ }
    jobs.set(url, job)
    queue.push(job)
  }

  const currentJob = job
  const token = Symbol(url)
  currentJob.consumers.add(token)
  currentJob.priority = Math.max(currentJob.priority, priority)

  const release = () => {
    currentJob.consumers.delete(token)
    if (currentJob.consumers.size > 0) return
    if (currentJob.status === 'queued') removeQueuedJob(currentJob, abortError())
    else {
      currentJob.controller.abort()
      if (jobs.get(currentJob.url) === currentJob) jobs.delete(currentJob.url)
    }
  }

  if (signal) signal.addEventListener('abort', release, { once: true })
  if (currentJob.status === 'queued') {
    queue.sort((left, right) => right.priority - left.priority || left.order - right.order)
    while (queue.length > MAX_PENDING_THUMBNAILS) {
      const dropped = queue.pop()
      if (dropped) removeQueuedJob(dropped, new Error('Thumbnail queue limit reached.'))
    }
  }
  drainQueue()

  return currentJob.promise.finally(() => signal?.removeEventListener('abort', release))
}

export function usePhotoThumbnail(url: string | undefined, priority = 0) {
  const [state, setState] = useState<{ url: string; raster?: PhotoRaster; error?: true }>()

  useEffect(() => {
    let active = true
    if (!url) {
      setState(undefined)
      return () => { active = false }
    }
    const cached = cache.get(url)
    if (cached) {
      touch(url, cached)
      setState({ url, raster: cached.raster })
      return () => { active = false }
    }
    setState(undefined)
    const controller = new AbortController()
    void loadPhotoThumbnail(url, controller.signal, priority).then((raster) => {
      if (active) setState({ url, raster })
    }).catch((error: unknown) => {
      if (active && !(error instanceof DOMException && error.name === 'AbortError')) setState({ url, error: true })
    })
    return () => {
      active = false
      controller.abort()
    }
  }, [priority, url])

  return state?.url === url ? state : undefined
}
