import type { UpdateChannel, UpdateStatus } from './update-store'

export function normalizeUpdateChannel(value: unknown): UpdateChannel {
  return value === 'beta' ? 'beta' : 'stable'
}

export function canInstallUpdate(status: UpdateStatus, persistenceReady: boolean, exportBusy: boolean): boolean {
  return status === 'readyToRestart' && persistenceReady && !exportBusy
}
