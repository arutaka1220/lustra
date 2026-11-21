import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  isTauri: vi.fn(() => true),
  getVersion: vi.fn(async () => '0.1.0'),
  readAppPreference: vi.fn(),
  writeAppPreference: vi.fn(async () => undefined),
  flushSessionPersistence: vi.fn(async () => undefined),
  preferences: new Map<string, unknown>(),
  fetchedUpdate: null as null | { version: string; currentVersion: string; notes: string; publishedAt: string },
  downloadError: null as Error | null,
  installError: null as Error | null,
  channelInstances: [] as MockChannel<unknown>[],
}))

class MockChannel<T> {
  onmessage?: (message: T) => void
  constructor() {
    mocks.channelInstances.push(this as MockChannel<unknown>)
  }
}

vi.mock('@tauri-apps/api/core', () => ({
  Channel: MockChannel,
  invoke: mocks.invoke,
  isTauri: mocks.isTauri,
}))
vi.mock('@tauri-apps/api/app', () => ({ getVersion: mocks.getVersion }))
vi.mock('../src/store/session-persistence', () => ({
  flushSessionPersistence: mocks.flushSessionPersistence,
  readAppPreference: vi.fn(async (key: string) => mocks.preferences.get(key) ?? null),
  writeAppPreference: vi.fn(async (key: string, value: unknown) => { mocks.preferences.set(key, value) }),
}))

type UpdateStoreModule = typeof import('../src/features/updates/update-store')
let store: UpdateStoreModule['useUpdateStore']

async function loadStore() {
  vi.resetModules()
  const module = await import('../src/features/updates/update-store')
  store = module.useUpdateStore
}

function emitProgress() {
  const channel = mocks.channelInstances.at(-1)
  channel?.onmessage?.({ event: 'started', data: { contentLength: 10 } })
  channel?.onmessage?.({ event: 'progress', data: { chunkLength: 4 } })
  channel?.onmessage?.({ event: 'progress', data: { chunkLength: 6 } })
  channel?.onmessage?.({ event: 'finished' })
}

beforeEach(async () => {
  mocks.preferences.clear()
  mocks.fetchedUpdate = null
  mocks.downloadError = null
  mocks.installError = null
  mocks.channelInstances = []
  mocks.getVersion.mockResolvedValue('0.1.0')
  mocks.flushSessionPersistence.mockResolvedValue(undefined)
  mocks.invoke.mockReset().mockImplementation(async (command: string) => {
    if (command === 'fetch_update') return mocks.fetchedUpdate
    if (command === 'download_update') {
      if (mocks.downloadError) throw mocks.downloadError
      emitProgress()
      return undefined
    }
    if (command === 'install_update') {
      if (mocks.installError) throw mocks.installError
      return undefined
    }
    throw new Error(`Unexpected Tauri command: ${command}`)
  })
  await loadStore()
})

afterEach(() => vi.clearAllMocks())

describe('update store with local Tauri mocks', () => {
  it('defaults to Stable and persists selected channel and automatic setting', async () => {
    expect(store.getState().channel).toBe('stable')
    expect(store.getState().automatic).toBe(true)

    await store.getState().setAutomatic(false)
    await store.getState().setChannel('beta')

    expect(mocks.preferences.get('updates.channel')).toBe('beta')
    expect(mocks.preferences.get('updates.automatic')).toBe(false)
    expect(mocks.invoke).not.toHaveBeenCalledWith('fetch_update', expect.anything())
  })

  it('restores a saved channel and automatic-update preference', async () => {
    mocks.preferences.set('updates.channel', 'beta')
    mocks.preferences.set('updates.automatic', false)
    await store.getState().initialize()

    expect(store.getState().channel).toBe('beta')
    expect(store.getState().automatic).toBe(false)
    expect(mocks.invoke).not.toHaveBeenCalled()
  })

  it('rechecks the newly selected channel when a previous request is still in flight', async () => {
    let resolveOldRequest: ((update: null) => void) | undefined
    let fetchCount = 0
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command !== 'fetch_update') throw new Error(`Unexpected Tauri command: ${command}`)
      fetchCount += 1
      if (fetchCount === 1) return new Promise<null>((resolve) => { resolveOldRequest = resolve })
      return null
    })

    const oldRequest = store.getState().check(true)
    expect(store.getState().status).toBe('checking')
    await store.getState().setChannel('beta')
    resolveOldRequest?.(null)
    await oldRequest

    expect(mocks.invoke).toHaveBeenNthCalledWith(1, 'fetch_update', { channel: 'stable' })
    expect(mocks.invoke).toHaveBeenNthCalledWith(2, 'fetch_update', { channel: 'beta' })
    expect(store.getState().channel).toBe('beta')
    expect(store.getState().status).toBe('upToDate')
  })

  it('records an up-to-date result and the last check time', async () => {
    await store.getState().setAutomatic(false)
    await store.getState().check()

    expect(store.getState().status).toBe('upToDate')
    expect(store.getState().lastChecked).toMatch(/^\d{4}-\d\d-/)
    expect(mocks.preferences.get('updates.last-check')).toBe(store.getState().lastChecked)
  })

  it('automatically downloads available updates and records progress', async () => {
    mocks.fetchedUpdate = { version: '0.2.0-beta.1', currentVersion: '0.1.0', notes: 'Preview', publishedAt: '' }
    await store.getState().initialize()

    expect(mocks.invoke).toHaveBeenCalledWith('fetch_update', { channel: 'stable' })
    expect(store.getState().status).toBe('readyToRestart')
    expect(store.getState().update?.version).toBe('0.2.0-beta.1')
    expect(store.getState().downloaded).toBe(10)
    expect(store.getState().contentLength).toBe(10)
  })

  it('does not auto-download when automatic updates are off but allows manual download', async () => {
    await store.getState().setAutomatic(false)
    mocks.fetchedUpdate = { version: '0.1.1', currentVersion: '0.1.0', notes: 'Fix', publishedAt: '' }
    await store.getState().check(true)

    expect(store.getState().status).toBe('available')
    expect(mocks.invoke).not.toHaveBeenCalledWith('download_update', expect.anything())
    await store.getState().download()
    expect(store.getState().status).toBe('readyToRestart')
    expect(store.getState().downloaded).toBe(10)
  })

  it('exposes network errors and offers another check', async () => {
    mocks.invoke.mockRejectedValueOnce(new Error('network unavailable'))
    await store.getState().check()

    expect(store.getState().status).toBe('failed')
    expect(store.getState().error).toContain('network unavailable')
    await store.getState().check()
    expect(store.getState().status).toBe('upToDate')
  })

  it('rejects a package when signature verification fails', async () => {
    await store.getState().setAutomatic(false)
    mocks.fetchedUpdate = { version: '0.1.1', currentVersion: '0.1.0', notes: 'Fix', publishedAt: '' }
    await store.getState().check()
    mocks.downloadError = new Error('signature verification failed')
    await store.getState().download()

    expect(store.getState().status).toBe('failed')
    expect(store.getState().error).toContain('signature verification failed')
  })

  it('does not install while export is active or session persistence fails', async () => {
    store.setState({ status: 'readyToRestart' })
    await store.getState().install(true)
    expect(mocks.invoke).not.toHaveBeenCalledWith('install_update', expect.anything())

    mocks.flushSessionPersistence.mockRejectedValueOnce(new Error('session write failed'))
    await store.getState().install(false)
    expect(mocks.invoke).not.toHaveBeenCalledWith('install_update', expect.anything())
    expect(store.getState().status).toBe('failed')
    expect(store.getState().error).toContain('session write failed')
  })

  it('flushes the session before installation and keeps failures visible', async () => {
    store.setState({ status: 'readyToRestart' })
    mocks.installError = new Error('installer failed')
    await store.getState().install(false)

    expect(mocks.flushSessionPersistence).toHaveBeenCalledOnce()
    expect(mocks.invoke).toHaveBeenCalledWith('install_update', { channel: 'stable' })
    expect(store.getState().status).toBe('failed')
    expect(store.getState().error).toContain('installer failed')
  })
})
