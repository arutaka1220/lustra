import { describe, expect, it } from 'vitest'
import { migrateLegacyWhite } from '../src/store/session-snapshot'

describe('legacy White migration', () => {
  it('moves saved White to Soft White while preserving other frame values and history', () => {
    const ws = { commonFrame: { style: 'white', top: 8 }, photos: [{ overrides: { style: 'white' } }], removedPhotos: [], history: { detachedPhotos: {}, common: { undo: [{ change: { kind: 'common', values: { before: { style: 'white' }, after: { style: 'black' } } } }], redo: [] }, photos: {} } } as any
    const migrated = migrateLegacyWhite(ws)
    expect(migrated.commonFrame.style).toBe('softWhite')
    expect(migrated.photos[0].overrides.style).toBe('softWhite')
    expect(migrated.history.common.undo[0].change.values.before.style).toBe('softWhite')
    expect(migrated.history.common.undo[0].change.values.after.style).toBe('black')
  })
})
