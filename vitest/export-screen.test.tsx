import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExportScreen } from '../src/features/export/ExportScreen'
import type { ExportEvent } from '../src/features/export/export-model'

const mocks = vi.hoisted(() => ({
  beginExport: vi.fn(),
  cancelExport: vi.fn(),
  getEffectiveFrame: vi.fn(() => ({ style: 'black', top: 0, bottom: 0, left: 0, right: 0, linkSides: true, linkVertical: false, blurStrength: 20 })),
  releaseCloseGuard: vi.fn(),
}))

vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { resolvedLanguage: 'en' } }) }))
vi.mock('../src/store/session-persistence', () => ({ registerWindowCloseGuard: () => mocks.releaseCloseGuard }))
vi.mock('../src/store/session-store', () => ({ getEffectiveFrame: mocks.getEffectiveFrame }))
vi.mock('../src/features/text/metadata-corrections-store', () => ({ useMetadataCorrections: (select: (state: { corrections: object }) => unknown) => select({ corrections: {} }) }))
vi.mock('../src/features/text/text-model', () => ({ getEffectiveMetadata: () => ({}), resolveTextLayers: () => [] }))
vi.mock('../src/features/export/ExportPreferencesPanel', () => ({ ExportPreferencesContent: () => null }))
vi.mock('../src/features/export/useExportPreferences', () => ({ useExportPreferences: () => ({
  preferences: { destination: '/tmp/export-test', format: 'jpeg', size: 'original', quality: 90, colorSpace: 'srgb', keepCamera: true, keepLens: true, keepExposure: true, keepDate: true, keepGps: false, keepSerial: false, applyMetadataCorrections: false },
  capabilities: { formats: ['jpeg'], metadataFormats: ['jpeg'], iccFormats: ['jpeg'] },
  destinationApproved: true,
  pickingDestination: false,
}) }))
vi.mock('../src/features/export/export-model', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/features/export/export-model')>()
  return { ...actual, beginExport: mocks.beginExport, cancelExport: mocks.cancelExport, exportError: String }
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

async function advanceFrame(frames: FrameRequestCallback[]) {
  const frame = frames.shift()
  expect(frame).toBeDefined()
  await act(async () => {
    frame!(0)
    await Promise.resolve()
  })
}

const photos = Array.from({ length: 30 }, (_, index) => ({
  id: `photo-${index}`,
  name: `photo-${index}.jpg`,
  source: { kind: 'path' as const, path: `/tmp/photo-${index}.jpg`, url: `file:///tmp/photo-${index}.jpg` },
  selected: true,
  metadata: {},
  metadataState: 'complete' as const,
  completed: true,
  overrides: {},
}))

describe('ExportScreen start guard', () => {
  beforeEach(() => {
    mocks.beginExport.mockReset()
    mocks.cancelExport.mockReset()
    mocks.getEffectiveFrame.mockClear()
    mocks.releaseCloseGuard.mockReset()
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('shows preparation while start is delayed, ignores repeated submits, and permits a later run', async () => {
    const starts: Array<ReturnType<typeof deferred<string>>> = []
    const events: Array<(event: ExportEvent) => void> = []
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback)
      return frames.length
    })
    mocks.beginExport.mockImplementation((_destination: string, _jobs: unknown[], _settings: unknown, onEvent: typeof events[number]) => {
      const start = deferred<string>()
      starts.push(start)
      events.push(onEvent)
      return start.promise
    })

    render(<ExportScreen photos={photos as never} commonFrame={{} as never} onBackToReview={() => {}} onBackToEditing={() => {}} onFinish={() => {}} onBusyChange={() => {}} />)
    const submit = screen.getByRole('button', { name: 'Export', exact: true })
    const form = submit.closest('form')!
    act(() => {
      for (let index = 0; index < 10; index++) fireEvent.click(submit)
      fireEvent.submit(form)
    })

    expect(screen.getByRole('status')).toHaveTextContent('Preparing export...')
    expect(screen.getByText('Preparing 30 photos for export.')).toBeInTheDocument()
    expect(mocks.getEffectiveFrame).not.toHaveBeenCalled()
    expect(mocks.beginExport).not.toHaveBeenCalled()

    await advanceFrame(frames)
    expect(mocks.getEffectiveFrame).not.toHaveBeenCalled()
    await advanceFrame(frames)
    expect(mocks.getEffectiveFrame).toHaveBeenCalledTimes(20)
    await advanceFrame(frames)
    await waitFor(() => expect(mocks.beginExport).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('button', { name: 'Cancel export' })).toBeDisabled()

    await act(async () => {
      events[0]({ type: 'photo', id: photos[0].id, outcome: { type: 'success', path: '/tmp/photo-0.jpg' }, processed: 1, total: 30 })
    })
    expect(await screen.findByText('1 of 30 photos processed')).toBeInTheDocument()
    expect(screen.queryByText('Preparing 30 photos for export.')).not.toBeInTheDocument()

    await act(async () => { starts[0].resolve('run-1'); await starts[0].promise })
    expect(await screen.findByText('1 of 30 photos processed')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel export' })).toBeEnabled()

    await act(async () => {
      events[0]({ type: 'photo', id: photos[0].id, outcome: { type: 'success', path: '/tmp/photo-0.jpg' }, processed: 1, total: 30 })
      events[0]({ type: 'finished', cancelled: false, cleanupErrors: [], deletedIds: [] })
    })
    fireEvent.click(screen.getByRole('button', { name: 'Retry failed' }))
    expect(screen.getByText('Preparing 29 photos for export.')).toBeInTheDocument()
    await advanceFrame(frames)
    await advanceFrame(frames)
    await advanceFrame(frames)
    await waitFor(() => expect(mocks.beginExport).toHaveBeenCalledTimes(2))
    expect(mocks.beginExport.mock.calls[1][1]).toHaveLength(29)
    events[0]({ type: 'finished', cancelled: false, cleanupErrors: [], deletedIds: [] })
    expect(screen.getByText('Preparing 29 photos for export.')).toBeInTheDocument()
  })

  it('cancels during local preparation and ignores the queued continuation', async () => {
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback)
      return frames.length
    })
    render(<ExportScreen photos={photos as never} commonFrame={{} as never} onBackToReview={() => {}} onBackToEditing={() => {}} onFinish={() => {}} onBusyChange={() => {}} />)

    fireEvent.click(screen.getByRole('button', { name: 'Export', exact: true }))
    expect(screen.getByText('Preparing 30 photos for export.')).toBeInTheDocument()
    expect(mocks.getEffectiveFrame).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel export' }))
    fireEvent.click(screen.getByRole('button', { name: 'Keep exported files' }))
    expect(screen.getByRole('button', { name: 'Export', exact: true })).toBeInTheDocument()

    await advanceFrame(frames)
    await advanceFrame(frames)
    expect(mocks.getEffectiveFrame).not.toHaveBeenCalled()
    expect(mocks.beginExport).not.toHaveBeenCalled()
  })

  it('yields while preparing a 100-photo batch', async () => {
    const frames: FrameRequestCallback[] = []
    const hundredPhotos = Array.from({ length: 100 }, (_, index) => ({
      ...photos[index % photos.length],
      id: `large-batch-${index}`,
      name: `large-batch-${index}.jpg`,
      source: { kind: 'path' as const, path: `/tmp/large-batch-${index}.jpg`, url: `file:///tmp/large-batch-${index}.jpg` },
    }))
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback)
      return frames.length
    })
    mocks.beginExport.mockResolvedValue('run-100')
    render(<ExportScreen photos={hundredPhotos as never} commonFrame={{} as never} onBackToReview={() => {}} onBackToEditing={() => {}} onFinish={() => {}} onBusyChange={() => {}} />)

    fireEvent.click(screen.getByRole('button', { name: 'Export', exact: true }))
    expect(screen.getByText('Preparing 100 photos for export.')).toBeInTheDocument()
    expect(mocks.getEffectiveFrame).not.toHaveBeenCalled()

    await advanceFrame(frames)
    await advanceFrame(frames)
    expect(mocks.getEffectiveFrame).toHaveBeenCalledTimes(20)
    for (let completed = 40; completed <= 80; completed += 20) {
      await advanceFrame(frames)
      expect(mocks.getEffectiveFrame).toHaveBeenCalledTimes(completed)
      expect(mocks.beginExport).not.toHaveBeenCalled()
    }

    await advanceFrame(frames)
    await waitFor(() => expect(mocks.beginExport).toHaveBeenCalledTimes(1))
    expect(mocks.beginExport.mock.calls[0][1]).toHaveLength(100)
    expect(await screen.findByText('0 of 100 photos processed')).toBeInTheDocument()
  })

  it('ignores a late start rejection after the next run has taken ownership', async () => {
    const starts: Array<ReturnType<typeof deferred<string>>> = []
    const events: Array<(event: ExportEvent) => void> = []
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback)
      return frames.length
    })
    mocks.beginExport.mockImplementation((_destination: string, _jobs: unknown[], _settings: unknown, onEvent: typeof events[number]) => {
      const start = deferred<string>()
      starts.push(start)
      events.push(onEvent)
      return start.promise
    })
    render(<ExportScreen photos={photos as never} commonFrame={{} as never} onBackToReview={() => {}} onBackToEditing={() => {}} onFinish={() => {}} onBusyChange={() => {}} />)

    fireEvent.click(screen.getByRole('button', { name: 'Export', exact: true }))
    await advanceFrame(frames)
    await advanceFrame(frames)
    await advanceFrame(frames)
    await waitFor(() => expect(mocks.beginExport).toHaveBeenCalledTimes(1))
    await act(async () => { events[0]({ type: 'finished', cancelled: false, cleanupErrors: [], deletedIds: [] }) })

    fireEvent.click(screen.getByRole('button', { name: 'Export again' }))
    fireEvent.click(screen.getByRole('button', { name: 'Export', exact: true }))
    await advanceFrame(frames)
    await advanceFrame(frames)
    await advanceFrame(frames)
    await waitFor(() => expect(mocks.beginExport).toHaveBeenCalledTimes(2))

    await act(async () => { starts[0].reject(new Error('late duplicate start rejection')) })
    expect(screen.getByText('Preparing 30 photos for export.')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    await act(async () => { starts[1].resolve('run-2'); await starts[1].promise })
    expect(await screen.findByText('0 of 30 photos processed')).toBeInTheDocument()
  })

  it('releases the run guard after a start failure so the user can retry', async () => {
    const frames: FrameRequestCallback[] = []
    const retryStart = deferred<string>()
    let retryEvent: ((event: ExportEvent) => void) | undefined
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback)
      return frames.length
    })
    mocks.beginExport
      .mockRejectedValueOnce(new Error('destination is not writable'))
      .mockImplementationOnce((_destination: string, _jobs: unknown[], _settings: unknown, onEvent: (event: ExportEvent) => void) => {
        retryEvent = onEvent
        return retryStart.promise
      })
    render(<ExportScreen photos={photos.slice(0, 1) as never} commonFrame={{} as never} onBackToReview={() => {}} onBackToEditing={() => {}} onFinish={() => {}} onBusyChange={() => {}} />)

    fireEvent.click(screen.getByRole('button', { name: 'Export', exact: true }))
    await advanceFrame(frames)
    await advanceFrame(frames)
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not start exporting.')
    expect(screen.getByRole('button', { name: 'Export', exact: true })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Export', exact: true }))
    await advanceFrame(frames)
    await advanceFrame(frames)
    await waitFor(() => expect(mocks.beginExport).toHaveBeenCalledTimes(2))
    await act(async () => { retryStart.resolve('run-retry'); await retryStart.promise })
    await act(async () => { retryEvent?.({ type: 'finished', cancelled: false, cleanupErrors: [], deletedIds: [] }) })
    expect(await screen.findByText('Export results')).toBeInTheDocument()
  })
})
