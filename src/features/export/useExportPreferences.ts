import { isTauri } from '@tauri-apps/api/core'
import { useEffect } from 'react'
import { create } from 'zustand'
import { readAppPreference, writeAppPreference } from '../../store/session-persistence'
import {
  checkExportDestination,
  defaultExportPreferences,
  exportError,
  loadExportCapabilities,
  normalizeExportPreferences,
  pickExportDestination,
} from './export-model'
import type { ExportCapabilities, ExportPreferences } from './export-model'

type ExportPreferencesState = {
  preferences: ExportPreferences
  capabilities: ExportCapabilities | null
  destinationApproved: boolean
  pickingDestination: boolean
  status: 'idle' | 'loading' | 'ready' | 'error'
  loadError: string
  saveError: string
  destinationError: string
  load: () => Promise<void>
  change: <K extends keyof ExportPreferences>(field: K, value: ExportPreferences[K]) => void
  chooseDestination: (title: string) => Promise<void>
}

const preferenceKey = 'export.settings'
let saveRevision = 0

const useExportPreferencesStore = create<ExportPreferencesState>((set, get) => ({
  preferences: defaultExportPreferences,
  capabilities: null,
  destinationApproved: false,
  pickingDestination: false,
  status: 'idle',
  loadError: '',
  saveError: '',
  destinationError: '',
  load: async () => {
    const { status } = get()
    if (!isTauri() || status === 'loading' || status === 'ready') return

    set({ status: 'loading', loadError: '' })
    try {
      const [capabilities, saved] = await Promise.all([
        loadExportCapabilities(),
        readAppPreference<ExportPreferences>(preferenceKey),
      ])
      const preferences = normalizeExportPreferences(saved)
      if (!capabilities.formats.includes(preferences.format)) preferences.format = capabilities.formats[0] ?? 'jpeg'
      const destinationApproved = !!preferences.destination && await checkExportDestination(preferences.destination)
      set({ preferences, capabilities, destinationApproved, status: 'ready' })
    } catch (error) {
      set({ status: 'error', loadError: exportError(error) })
    }
  },
  change: (field, value) => {
    if (get().preferences[field] === value) return
    const preferences = { ...get().preferences, [field]: value }
    const revision = ++saveRevision
    set({ preferences, saveError: '' })
    void writeAppPreference(preferenceKey, preferences).catch((error: unknown) => {
      if (revision === saveRevision) set({ saveError: exportError(error) })
    })
  },
  chooseDestination: async (title) => {
    if (get().pickingDestination) return
    set({ pickingDestination: true, destinationError: '' })
    try {
      const path = await pickExportDestination(get().preferences.destination, title)
      if (path) {
        get().change('destination', path)
        set({ destinationApproved: true })
      }
    } catch (error) {
      set({ destinationError: exportError(error) })
    } finally {
      set({ pickingDestination: false })
    }
  },
}))

export function useExportPreferences() {
  const preferences = useExportPreferencesStore()
  const load = preferences.load
  useEffect(() => { void load() }, [load])
  return preferences
}
