import { afterEach, describe, expect, it, vi } from 'vitest'
import { editPreviewCacheStats, loadEditPreview, previewNeighborIndices, PREVIEW_CACHE_LIMIT } from '../src/features/editor/preview-cache'

describe('edit preview prefetch policy', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
  it('chooses the two nearest photos on both sides and respects boundaries', () => {
    expect(previewNeighborIndices(8, 3)).toEqual([2, 4, 1, 5])
    expect(previewNeighborIndices(8, 0)).toEqual([1, 2])
    expect(previewNeighborIndices(8, 7)).toEqual([6, 5])
    expect(previewNeighborIndices(0, 0)).toEqual([])
  })
  it('keeps the high resolution cache bounded to 128 MiB', () => {
    expect(PREVIEW_CACHE_LIMIT).toBe(128 * 1024 * 1024)
  })
  it('shares the same decode for concurrent requests and reuses the cached raster', async () => {
    let decodes = 0
    class MockImage {
      naturalWidth = 3000
      naturalHeight = 3000
      crossOrigin = ''
      set src(_value: string) {}
      removeAttribute(_value: string) {}
      async decode() { decodes++ }
    }
    vi.stubGlobal('Image', MockImage)
    const create = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      if (tag !== 'canvas') return create(tag)
      const canvas = { width: 0, height: 0, getContext: () => ({ imageSmoothingQuality: '', drawImage: vi.fn() }) } as unknown as HTMLCanvasElement
      return canvas
    }) as typeof document.createElement)
    const url = `preview-cache-test-${crypto.randomUUID()}`
    const [first, second] = await Promise.all([loadEditPreview(url), loadEditPreview(url)])
    expect(first).toBe(second)
    expect(decodes).toBe(1)
    expect(first.width).toBe(2048)
    expect(await loadEditPreview(url)).toBe(first)
    expect(decodes).toBe(1)
    for (let i = 0; i < 9; i++) await loadEditPreview(`${url}-${i}`)
    expect(editPreviewCacheStats().bytes).toBeLessThanOrEqual(PREVIEW_CACHE_LIMIT)
    expect(editPreviewCacheStats().entries).toBeLessThanOrEqual(8)
  })
  it('cancels a no-longer-needed preview request', async () => {
    class MockImage {
      naturalWidth = 1000
      naturalHeight = 500
      crossOrigin = ''
      set src(_value: string) {}
      removeAttribute(_value: string) {}
      async decode() {}
    }
    vi.stubGlobal('Image', MockImage)
    const create = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => tag === 'canvas'
      ? ({ width: 0, height: 0, getContext: () => ({ imageSmoothingQuality: '', drawImage: vi.fn() }) } as unknown as HTMLCanvasElement)
      : create(tag)) as typeof document.createElement)
    const controller = new AbortController()
    const request = loadEditPreview(`preview-cancel-${crypto.randomUUID()}`, 512, controller.signal, 1)
    controller.abort()
    await expect(request).rejects.toMatchObject({ name: 'AbortError' })
  })
  it('cancels a preview that has no remaining consumers', async () => {
    class MockImage {
      naturalWidth = 1000
      naturalHeight = 500
      crossOrigin = ''
      set src(_value: string) {}
      removeAttribute(_value: string) {}
      async decode() {}
    }
    vi.stubGlobal('Image', MockImage)
    const create = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => tag === 'canvas'
      ? ({ width: 0, height: 0, getContext: () => ({ imageSmoothingQuality: '', drawImage: vi.fn() }) } as unknown as HTMLCanvasElement)
      : create(tag)) as typeof document.createElement)
    const controller = new AbortController()
    const pending = loadEditPreview(`preview-abort-${crypto.randomUUID()}`, 512, controller.signal)
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })
  it('fails a stuck image decode instead of keeping a worker slot indefinitely', async () => {
    vi.useFakeTimers()
    class MockImage {
      naturalWidth = 1000
      naturalHeight = 500
      crossOrigin = ''
      set src(_value: string) {}
      removeAttribute(_value: string) {}
      decode() { return new Promise<void>(() => {}) }
    }
    vi.stubGlobal('Image', MockImage)
    const request = loadEditPreview(`preview-timeout-${crypto.randomUUID()}`)
    const rejection = expect(request).rejects.toThrow(/timed out/i)
    await vi.advanceTimersByTimeAsync(20_000)
    await rejection
    await Promise.resolve()
    expect(editPreviewCacheStats().running).toBe(0)
  })
})
