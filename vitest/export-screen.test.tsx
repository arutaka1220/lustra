import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ExportScreen } from '../src/features/export/ExportScreen'

const mocks = vi.hoisted(() => ({
  beginExport: vi.fn(),
  cancelExport: vi.fn(),
  releaseCloseGuard: vi.fn(),
}))

vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { resolvedLanguage: 'en' } }) }))
vi.mock('../src/store/session-persistence', () => ({ registerWindowCloseGuard: () => mocks.releaseCloseGuard }))
vi.mock('../src/store/session-store', () => ({ getEffectiveFrame: () => ({ style: 'black', top: 0, bottom: 0, left: 0, right: 0, linkSides: true, linkVertical: false, blurStrength: 20 }), }))
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
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
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
  beforeEach(() => { mocks.beginExport.mockReset(); mocks.cancelExport.mockReset(); mocks.releaseCloseGuard.mockReset() })

  it('shows preparation while start is delayed, ignores repeated submits, and permits a later run', async () => {
    const starts: Array<ReturnType<typeof deferred<string>>> = []
    const events: Array<(event: { type: 'finished'; cancelled: boolean; cleanupErrors: string[]; deletedIds: string[] }) => void> = []
    mocks.beginExport.mockImplementation((_destination: string, _jobs: unknown[], _settings: unknown, onEvent: typeof events[number]) => {
      const start = deferred<string>()
      starts.push(start)
      events.push(onEvent)
      return start.promise
    })

    render(<ExportScreen photos={photos as never} commonFrame={{} as never} onBackToReview={() => {}} onBackToEditing={() => {}} onFinish={() => {}} onBusyChange={() => {}} />)
    const submit = screen.getByRole('button', { name: 'Export', exact: true })
    for (let index = 0; index < 10; index++) fireEvent.click(submit)

    expect(screen.getByRole('status')).toHaveTextContent('Preparing export...')
    expect(screen.getByText('Preparing 30 photos for export.')).toBeInTheDocument()
    await waitFor(() => expect(mocks.beginExport).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('button', { name: 'Cancel export' })).toBeDisabled()

    await act(async () => { starts[0].resolve('run-1'); await starts[0].promise })
    expect(await screen.findByText('0 of 30 photos processed')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel export' })).toBeEnabled()

    await act(async () => { events[0]({ type: 'finished', cancelled: false, cleanupErrors: [], deletedIds: [] }) })
    fireEvent.click(screen.getByRole('button', { name: 'Export again' }))
    fireEvent.click(screen.getByRole('button', { name: 'Export', exact: true }))
    await waitFor(() => expect(mocks.beginExport).toHaveBeenCalledTimes(2))
  })
})
