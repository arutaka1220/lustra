import { describe, expect, it } from 'vitest'
import { canInstallUpdate, normalizeUpdateChannel } from '../src/features/updates/update-policy'

describe('update policy', () => {
  it('defaults missing or unknown channel preferences to Stable', () => {
    expect(normalizeUpdateChannel(null)).toBe('stable')
    expect(normalizeUpdateChannel('nightly')).toBe('stable')
  })

  it('restores Beta when the saved preference is valid', () => {
    expect(normalizeUpdateChannel('beta')).toBe('beta')
  })

  it('allows installation only after a verified download and safe session state', () => {
    expect(canInstallUpdate('readyToRestart', true, false)).toBe(true)
    expect(canInstallUpdate('readyToRestart', false, false)).toBe(false)
    expect(canInstallUpdate('readyToRestart', true, true)).toBe(false)
    expect(canInstallUpdate('downloading', true, false)).toBe(false)
  })
})
