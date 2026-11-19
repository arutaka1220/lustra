import { Channel, invoke } from '@tauri-apps/api/core'
import type { FrameSettings } from '../../types/photo'
import type { TextDrawRecipe } from '../text/text-model'

export const exportFormats = ['jpeg', 'png', 'webp'] as const
export const exportSizes = ['original', 720, 1080, 1440, 2160] as const
export const metadataFields = ['keepCamera', 'keepLens', 'keepExposure', 'keepDate', 'keepGps', 'keepSerial'] as const

export type ExportFormat = typeof exportFormats[number]
export type ExportSize = typeof exportSizes[number]

export type ExportSettings = {
  format: ExportFormat
  size: ExportSize
  quality: number
  colorSpace: 'srgb' | 'original'
  applyMetadataCorrections: boolean
} & Record<typeof metadataFields[number], boolean>

export type ExportPreferences = ExportSettings & { destination: string }
export type ExportCapabilities = {
  formats: ExportFormat[]
  metadataFormats: ExportFormat[]
  iccFormats: ExportFormat[]
}

export type ExportJob = {
  id: string
  path: string
  frame: FrameSettings
  text: TextDrawRecipe[]
  metadata?: { camera?: string; lens?: string }
}

export type ExportOutcome =
  | { type: 'success'; path: string }
  | { type: 'failed'; message: string }

export type ExportEvent =
  | { type: 'photo'; id: string; outcome: ExportOutcome; processed: number; total: number }
  | { type: 'finished'; cancelled: boolean; cleanupErrors: string[]; deletedIds: string[] }

export type CancelPolicy = 'keep' | 'delete'

export const defaultExportPreferences: ExportPreferences = {
  format: 'jpeg',
  size: 'original',
  quality: 90,
  colorSpace: 'srgb',
  keepCamera: true,
  keepLens: true,
  keepExposure: true,
  keepDate: true,
  keepGps: false,
  keepSerial: false,
  applyMetadataCorrections: false,
  destination: '',
}

export function normalizeExportPreferences(value: Partial<ExportPreferences> | null): ExportPreferences {
  const settings = { ...defaultExportPreferences }
  if (!value) return settings

  if (value.format && exportFormats.includes(value.format)) settings.format = value.format
  if (value.size && exportSizes.includes(value.size)) settings.size = value.size
  if (typeof value.quality === 'number' && Number.isFinite(value.quality)) {
    settings.quality = Math.min(100, Math.max(1, Math.round(value.quality)))
  }
  if (value.colorSpace === 'original') settings.colorSpace = value.colorSpace
  if (typeof value.destination === 'string') settings.destination = value.destination

  for (const field of [...metadataFields, 'applyMetadataCorrections'] as const) {
    if (typeof value[field] === 'boolean') settings[field] = value[field]
  }

  return settings
}

export function getExportSettings(preferences: ExportPreferences, capabilities: ExportCapabilities): ExportSettings {
  const { destination: _destination, ...settings } = preferences

  if (!capabilities.metadataFormats.includes(settings.format)) {
    for (const field of metadataFields) settings[field] = false
  }
  if (!settings.keepCamera && !settings.keepLens) settings.applyMetadataCorrections = false

  if (!capabilities.iccFormats.includes(settings.format)) settings.colorSpace = 'srgb'
  return settings
}

export function loadExportCapabilities() {
  return invoke<ExportCapabilities>('get_export_capabilities')
}

export function checkExportDestination(destination: string) {
  return invoke<boolean>('check_export_destination', { destination })
}

export function pickExportDestination(currentDestination: string, title: string) {
  return invoke<string | null>('choose_export_destination', {
    defaultPath: currentDestination || null,
    title,
  })
}

export function beginExport(destination: string, jobs: ExportJob[], settings: ExportSettings, onMessage: (event: ExportEvent) => void) {
  const onEvent = new Channel(onMessage)
  return invoke<string>('begin_export', { destination, jobs, settings, onEvent })
}

export function cancelExport(runId: string, policy: CancelPolicy) {
  return invoke<void>('cancel_export', { runId, policy })
}

export function exportError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
