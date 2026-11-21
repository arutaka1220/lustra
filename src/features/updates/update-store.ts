import { Channel, invoke, isTauri } from '@tauri-apps/api/core'
import { getVersion } from '@tauri-apps/api/app'
import { create } from 'zustand'
import { flushSessionPersistence, readAppPreference, writeAppPreference } from '../../store/session-persistence'
import { normalizeUpdateChannel } from './update-policy'

export type UpdateChannel = 'stable' | 'beta'
export type UpdateStatus = 'idle' | 'checking' | 'upToDate' | 'available' | 'downloading' | 'readyToRestart' | 'failed'

type UpdateMetadata = {
  version: string
  currentVersion: string
  notes?: string | null
  publishedAt?: string | null
}

type DownloadEvent =
  | { event: 'started'; data: { contentLength?: number | null } }
  | { event: 'progress'; data: { chunkLength: number } }
  | { event: 'finished' }

type UpdateState = {
  initialized: boolean
  version: string
  channel: UpdateChannel
  automatic: boolean
  status: UpdateStatus
  update: UpdateMetadata | null
  lastChecked: string | null
  downloaded: number
  contentLength: number | null
  error: string | null
  initialize: () => Promise<void>
  setChannel: (channel: UpdateChannel) => Promise<void>
  setAutomatic: (automatic: boolean) => Promise<void>
  check: (automaticDownload?: boolean) => Promise<void>
  download: () => Promise<void>
  install: (blocked: boolean) => Promise<void>
}

const CHANNEL_KEY = 'updates.channel'
const AUTOMATIC_KEY = 'updates.automatic'
const LAST_CHECK_KEY = 'updates.last-check'
const CHECK_INTERVAL = 6 * 60 * 60 * 1000

let periodicCheck: ReturnType<typeof setInterval> | undefined
let initialization: Promise<void> | undefined
let checkRevision = 0

export const useUpdateStore = create<UpdateState>((set, get) => ({
  initialized: false,
  version: '',
  channel: 'stable',
  automatic: true,
  status: 'idle',
  update: null,
  lastChecked: null,
  downloaded: 0,
  contentLength: null,
  error: null,

  initialize: async () => {
    if (initialization) return initialization
    initialization = (async () => {
      const [channel, automatic, lastChecked, version] = await Promise.all([
        readAppPreference<unknown>(CHANNEL_KEY),
        readAppPreference<unknown>(AUTOMATIC_KEY),
        readAppPreference<string>(LAST_CHECK_KEY),
        isTauri() ? getVersion().catch(() => '') : Promise.resolve(''),
      ])
      const normalizedChannel = normalizeUpdateChannel(channel)
      const automaticEnabled = automatic !== false
      set({ channel: normalizedChannel, automatic: automaticEnabled, lastChecked, version, initialized: true })

      if (isTauri() && automaticEnabled) {
        await get().check(true)
        periodicCheck = setInterval(() => {
          if (get().automatic) void get().check(true)
        }, CHECK_INTERVAL)
      }
    })().catch((error) => {
      initialization = undefined
      set({ initialized: true, status: 'failed', error: explain(error) })
    })
    return initialization
  },

  setChannel: async (channel) => {
    checkRevision += 1
    set({
      channel,
      error: null,
      // Let the new channel start its own request; the previous response is stale.
      status: get().status === 'checking' ? 'idle' : get().status,
    })
    try {
      await writeAppPreference(CHANNEL_KEY, channel)
      if (get().automatic && isTauri()) await get().check(true)
    } catch (error) {
      set({ status: 'failed', error: explain(error) })
    }
  },

  setAutomatic: async (automatic) => {
    set({ automatic, error: null })
    try {
      await writeAppPreference(AUTOMATIC_KEY, automatic)
    } catch (error) {
      set({ status: 'failed', error: explain(error) })
      return
    }
    if (!automatic && periodicCheck) {
      clearInterval(periodicCheck)
      periodicCheck = undefined
    }
    if (automatic && isTauri()) {
      await get().check(true)
      if (!periodicCheck) periodicCheck = setInterval(() => {
        if (get().automatic) void get().check(true)
      }, CHECK_INTERVAL)
    }
  },

  check: async (automaticDownload = false) => {
    if (!isTauri()) {
      set({ status: 'failed', error: 'Updates are available in the Lustra desktop app.' })
      return
    }
    if (get().status === 'checking' || get().status === 'downloading') return
    const requestRevision = ++checkRevision
    const requestedChannel = get().channel
    set({ status: 'checking', error: null, update: null, downloaded: 0, contentLength: null })
    try {
      const update = await invoke<UpdateMetadata | null>('fetch_update', { channel: requestedChannel })
      if (requestRevision !== checkRevision || requestedChannel !== get().channel) return
      const lastChecked = new Date().toISOString()
      set({ update, lastChecked, status: update ? 'available' : 'upToDate' })
      await writeAppPreference(LAST_CHECK_KEY, lastChecked)
      if (update && automaticDownload && get().automatic) await get().download()
    } catch (error) {
      if (requestRevision !== checkRevision || requestedChannel !== get().channel) return
      set({ status: 'failed', error: explain(error) })
    }
  },

  download: async () => {
    if (!get().update || get().status === 'downloading') return
    const onEvent = new Channel<DownloadEvent>()
    onEvent.onmessage = (event) => {
      if (event.event === 'started') set({ contentLength: event.data.contentLength ?? null })
      if (event.event === 'progress') set((state) => ({ downloaded: state.downloaded + event.data.chunkLength }))
      // The command resolves only after signature verification and state storage.
    }
    set({ status: 'downloading', downloaded: 0, contentLength: null, error: null })
    try {
      await invoke('download_update', { channel: get().channel, onEvent })
      set({ status: 'readyToRestart' })
    } catch (error) {
      set({ status: 'failed', error: explain(error) })
    }
  },

  install: async (blocked) => {
    if (blocked || get().status !== 'readyToRestart') return
    try {
      // Persist the complete session snapshot before handing control to the installer.
      await flushSessionPersistence()
      await invoke('install_update', { channel: get().channel })
    } catch (error) {
      set({ status: 'failed', error: explain(error) })
    }
  },
}))

function explain(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
