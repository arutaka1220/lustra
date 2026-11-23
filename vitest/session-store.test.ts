import { beforeEach, describe, expect, test } from 'vitest'
import { getEffectiveFrame, getSessionSnapshot, restoreSessionSnapshot, useSessionStore } from '../src/store/session-store'
import type { ImportCandidate } from '../src/types/photo'

function photo(id: string): ImportCandidate {
  const name = `${id}.jpg`
  const path = `/photos/${name}`
  return { id, name, source: { kind: 'path', path, url: path }, selected: true, metadata: {}, metadataState: 'ready' }
}

const session = useSessionStore.getState
const activeFrame = () => getEffectiveFrame(session().photos.find(({ id }) => id === session().activePhotoId), session().commonFrame)

beforeEach(() => useSessionStore.setState(useSessionStore.getInitialState(), true))

describe('session history and recovery', () => {
  test('legacy preset fields are ignored while editing state restores and new snapshots omit them', () => {
    session().addToSession([photo('legacy')])
    session().patchFrame({ style: 'softBlack', top: 17 })
    const archive = JSON.parse(JSON.stringify(getSessionSnapshot()))
    archive.framePresets = { old: { style: 'white' } }
    archive.active.framePresets = { old: { style: 'white' } }
    archive.active.photos[0].cropPresets = { old: { ratio: '4:3' } }
    useSessionStore.setState(useSessionStore.getInitialState(), true)
    restoreSessionSnapshot(archive)
    expect(session().commonFrame).toMatchObject({ style: 'softBlack' })
    expect(session().photos[0].id).toBe('legacy')
    const saved = getSessionSnapshot() as any
    expect(saved.framePresets).toBeUndefined()
    expect(saved.active.framePresets).toBeUndefined()
    expect(saved.active.photos[0].cropPresets).toBeUndefined()
  })

  test('crop geometry and rotation are one undoable edit and survive session snapshots', () => {
    session().addToSession([photo('crop')])
    session().setScreen('edit')
    session().setEditMode('this')
    session().beginFrameEdit()
    session().setPhotoCrop('crop', { x: 0.1, y: 0.2, width: 0.7, height: 0.6, rotation: 12.75, ratio: '4:3', locked: true })
    session().setPhotoCrop('crop', { x: 0.12, y: 0.2, width: 0.68, height: 0.6, rotation: 14.25, ratio: '4:3', locked: true })
    session().endFrameEdit()
    expect(session().history.photos.crop.undo).toHaveLength(1)
    session().undo()
    expect(session().photos[0].cropTransform).toBeUndefined()
    session().redo()
    const archive = JSON.parse(JSON.stringify(getSessionSnapshot()))
    useSessionStore.setState(useSessionStore.getInitialState(), true)
    restoreSessionSnapshot(archive)
    expect(session().photos[0].cropTransform).toMatchObject({ x: 0.12, width: 0.68, rotation: 14.25, ratio: '4:3' })
  })

  test('All Photos crop edits update every photo and undo as one edit', () => {
    session().addToSession([
      { ...photo('crop-a'), imageWidth: 1200, imageHeight: 800 },
      { ...photo('crop-b'), imageWidth: 800, imageHeight: 1200 },
    ])
    const crop = { x: 0.1, y: 0.15, width: 0.7, height: 0.65, rotation: 5.5, ratio: '4:3' as const, locked: true }
    session().beginFrameEdit()
    session().setPhotoCrop('crop-a', crop)
    session().setPhotoCrop('crop-a', { ...crop, rotation: 9.25 })
    session().endFrameEdit()
    expect(session().photos.map((item) => item.cropTransform?.rotation)).toEqual([9.25, 9.25])
    for (const item of session().photos) expect((item.cropTransform!.width * item.imageWidth!) / (item.cropTransform!.height * item.imageHeight!)).toBeCloseTo(4 / 3)
    expect(session().history.common.undo).toHaveLength(2)
    const snapshot = JSON.parse(JSON.stringify(getSessionSnapshot()))
    useSessionStore.setState(useSessionStore.getInitialState(), true)
    restoreSessionSnapshot(snapshot)
    expect(session().photos.map((item) => item.cropTransform?.rotation)).toEqual([9.25, 9.25])
    session().undo()
    expect(session().photos.every((item) => item.cropTransform === undefined)).toBe(true)
    session().redo()
    expect(session().photos.map((item) => item.cropTransform?.rotation)).toEqual([9.25, 9.25])
  })

  test('Edge Stretch settings survive per-photo edits, undo/redo, and session restoration', () => {
    session().addToSession([photo('edge')])
    session().setEditMode('this')
    session().beginFrameEdit()
    session().patchFrame({ style: 'edgeStretch', edgeStretchMode: 'mirror', edgeStretchBlur: 19, edgeStretchFade: 7 })
    session().endFrameEdit()
    expect(session().photos[0].overrides).toMatchObject({ style: 'edgeStretch', edgeStretchMode: 'mirror', edgeStretchBlur: 19, edgeStretchFade: 7 })
    session().undo()
    expect(session().photos[0].overrides).toEqual({})
    session().redo()
    const archive = JSON.parse(JSON.stringify(getSessionSnapshot()))
    useSessionStore.setState(useSessionStore.getInitialState(), true)
    restoreSessionSnapshot(archive)
    expect(session().photos[0].overrides).toMatchObject({ style: 'edgeStretch', edgeStretchMode: 'mirror', edgeStretchBlur: 19, edgeStretchFade: 7 })
  })
  test('Ambient Gradient settings survive undo, redo, and session snapshot restoration', () => {
    session().addToSession([photo('ambient')])
    session().setScreen('edit')
    session().patchFrame({ style: 'ambientGradient', ambientIntensity: 42, ambientSoftness: 31, ambientBrightness: -18, ambientColorSource: 'edges' })
    session().undo()
    expect(session().commonFrame.style).toBe('black')
    session().redo()
    expect(session().commonFrame).toMatchObject({ style: 'ambientGradient', ambientIntensity: 42, ambientSoftness: 31, ambientBrightness: -18, ambientColorSource: 'edges' })
    const archived = JSON.parse(JSON.stringify(getSessionSnapshot()))
    useSessionStore.setState(useSessionStore.getInitialState(), true)
    restoreSessionSnapshot(archived)
    expect(session().commonFrame).toMatchObject({ style: 'ambientGradient', ambientIntensity: 42, ambientSoftness: 31, ambientBrightness: -18, ambientColorSource: 'edges' })
  })

  test('Portrait Card settings remain independent, undoable, and restorable', () => {
    session().addToSession([photo('portrait')])
    session().patchFrame({ style: 'black', blurStrength: 10, backgroundBrightness: 100 })
    session().beginFrameEdit()
    session().patchFrame({ canvasLayout: 'portraitCard', portraitRatio: 4 / 5, portraitPhotoSize: 80, portraitVerticalPosition: 0, portraitBackgroundStyle: 'blurred', portraitBackgroundBlur: 40, portraitBackgroundBrightness: 90 })
    session().endFrameEdit()
    session().beginFrameEdit()
    session().patchFrame({ portraitPhotoSize: 65, portraitVerticalPosition: -0.15 })
    session().endFrameEdit()
    session().undo()
    expect(session().commonFrame).toMatchObject({ portraitPhotoSize: 80, portraitVerticalPosition: 0 })
    session().redo()
    session().patchFrame({ canvasLayout: 'standard' })
    expect(session().commonFrame).toMatchObject({ style: 'black', blurStrength: 10, portraitBackgroundStyle: 'blurred', portraitBackgroundBlur: 40, portraitBackgroundBrightness: 90 })
    session().patchFrame({ canvasLayout: 'portraitCard' })
    expect(session().commonFrame).toMatchObject({ portraitPhotoSize: 65, portraitVerticalPosition: -0.15 })
    const archive = JSON.parse(JSON.stringify(getSessionSnapshot()))
    useSessionStore.setState(useSessionStore.getInitialState(), true)
    restoreSessionSnapshot(archive)
    expect(session().commonFrame).toMatchObject({ portraitRatio: 4 / 5, portraitPhotoSize: 65, portraitVerticalPosition: -0.15, portraitBackgroundBlur: 40, portraitBackgroundBrightness: 90 })
  })

  test('undo prioritizes a reorder and a new shared edit leaves photo redo available', () => {
    session().addToSession([photo('a'), photo('b')])
    session().setEditMode('this')
    session().updateFrame('style', 'white')
    session().reorderPhotos('b', 'a')

    session().undo()
    expect(session().photos.map((item) => item.id)).toEqual(['a', 'b'])
    expect(session().photos[0].overrides.style).toBe('white')

    session().undo()
    expect(session().photos[0].overrides.style).toBeUndefined()
    session().setEditMode('all')
    session().updateFrame('top', 4)
    session().redo()

    expect(activeFrame().top).toBe(4)
    expect(session().photos[0].overrides.style).toBe('white')
    expect(session().photos.map((item) => item.id)).toEqual(['a', 'b'])
  })

  test('restores missing original paths and an entire slider gesture as one undo step', () => {
    session().addToSession([photo('a')])
    session().setScreen('edit')
    session().setEditMode('this')
    session().beginFrameEdit()
    session().updateFrame('left', 12)
    session().updateFrame('left', 18)
    session().endFrameEdit()
    const snapshot = JSON.parse(JSON.stringify(getSessionSnapshot()))

    useSessionStore.setState(useSessionStore.getInitialState(), true)
    restoreSessionSnapshot(snapshot, ['/photos/a.jpg'])
    expect(session().photos[0].source).toMatchObject({ missing: true, url: '' })
    expect(session().photos[0].overrides).toMatchObject({ left: 18, right: 18 })

    session().undo()
    expect(session().photos[0].overrides).toEqual({})
    session().redo()
    expect(session().photos[0].overrides).toMatchObject({ left: 18, right: 18 })
  })

  test('migrates legacy ratio and crop fields while preserving padding edits and history', () => {
    session().addToSession([photo('legacy')])
    session().updateFrame('bottom', 24)
    const legacy = JSON.parse(JSON.stringify(getSessionSnapshot())) as any
    legacy.active.commonFrame.ratio = '4:5'
    legacy.active.commonFrame.fit = 'fill'
    legacy.active.photos[0].crop = { x: 0.4, y: -0.2, zoom: 1.5 }
    legacy.active.photos[0].overrides = { left: 12, right: 12, ratio: '1:1', fit: 'fill' }
    const oldCommonEdit = legacy.active.history.common.undo.at(-1)
    oldCommonEdit.change.values.keys.push('ratio')
    oldCommonEdit.change.values.before.ratio = '4:5'
    oldCommonEdit.change.values.after.ratio = '1:1'

    useSessionStore.setState(useSessionStore.getInitialState(), true)
    restoreSessionSnapshot(legacy, [])

    expect(activeFrame().bottom).toBe(24)
    expect(session().photos[0].metadataState).toBe('loading')
    expect(session().commonFrame).not.toHaveProperty('ratio')
    expect(session().commonFrame).not.toHaveProperty('fit')
    expect(session().photos[0]).not.toHaveProperty('crop')
    expect(session().photos[0].overrides).toEqual({ left: 12, right: 12 })
    expect(session().history.common.undo.at(-1)?.change).toMatchObject({
      kind: 'common', values: { keys: ['aspectPadding'] },
    })

    session().undo()
    expect(activeFrame().bottom).toBe(15)
  })

  test('migrates version 1 White values in the session and history to Soft White', () => {
    session().addToSession([photo('old')])
    session().updateFrame('style', 'white')
    session().setEditMode('this')
    session().updateFrame('style', 'white')
    const old = JSON.parse(JSON.stringify(getSessionSnapshot())) as any
    old.version = 1
    useSessionStore.setState(useSessionStore.getInitialState(), true)
    restoreSessionSnapshot(old)
    expect(getSessionSnapshot().version).toBe(3)
    expect(session().commonFrame.style).toBe('softWhite')
    expect(session().photos[0].overrides.style).toBe('softWhite')
    expect(session().history.common.undo.at(-1)?.change).toMatchObject({ kind: 'common', values: { before: { style: 'black' }, after: { style: 'softWhite' } } })
    session().undo()
    expect(session().photos[0].overrides.style).toBeUndefined()
  })

  test('writes the current archive version and rejects unsupported versions without changing the store', () => {
    session().addToSession([photo('versioned')])
    const current = getSessionSnapshot()
    expect(current.version).toBe(3)

    const before = session().photos
    expect(() => restoreSessionSnapshot({ ...current, version: 4 })).toThrow('This session archive requires a newer version of Lustra.')
    expect(session().photos).toBe(before)
    expect(() => restoreSessionSnapshot({ ...current, version: 0 })).toThrow('This session archive is invalid or damaged.')
  })

  test('survives three serialized restart cycles with photo, frame, text, padding, color, and completion intact', () => {
    session().addToSession([photo('restart')])
    session().setScreen('edit')
    session().patchFrame({
      style: 'custom', customColor: '#123ABC', top: 12, bottom: 24, left: 9, right: 9,
      textElements: [{ id: 'title', template: '{camera} · ISO {iso}', anchor: 'bottom-left', anchorMode: 'photo', x: 34, y: -18, size: 20, fontFamily: 'Arial', weight: 400, color: '#123ABC', opacity: 42, visible: true }],
    })
    session().setCompleted('restart', true)

    for (let restart = 0; restart < 3; restart += 1) {
      const archived = JSON.parse(JSON.stringify(getSessionSnapshot()))
      useSessionStore.setState(useSessionStore.getInitialState(), true)
      restoreSessionSnapshot(archived)
      expect(getSessionSnapshot().version).toBe(3)
      expect(session().screen).toBe('edit')
      expect(session().photos).toHaveLength(1)
      expect(session().photos[0].completed).toBe(true)
      expect(session().commonFrame).toMatchObject({ style: 'custom', customColor: '#123ABC' })
      expect(activeFrame()).toMatchObject({ top: 12, bottom: 24, left: 9, right: 9 })
      expect(session().commonFrame.textElements?.[0]).toMatchObject({ template: '{camera} · ISO {iso}', color: '#123ABC', anchorMode: 'photo', opacity: 42 })
    }
  })

  test('links and unlinks both padding axes with one undoable change and restores link state', () => {
    session().addToSession([photo('padding')])
    session().updateFrame('left', 11)
    expect(activeFrame()).toMatchObject({ left: 11, right: 11 })
    session().updateFrame('linkSides', false)
    session().updateFrame('right', 20)
    session().updateFrame('left', 7)
    expect(activeFrame()).toMatchObject({ left: 7, right: 20, linkSides: false })
    session().patchFrame({ linkSides: true })
    expect(activeFrame()).toMatchObject({ left: 7, right: 7, linkSides: true })
    session().updateFrame('left', 10)
    expect(activeFrame()).toMatchObject({ left: 10, right: 10 })
    session().patchFrame({ linkSides: false })
    expect(activeFrame()).toMatchObject({ left: 7, right: 20, linkSides: false })
    session().undo()
    expect(activeFrame()).toMatchObject({ left: 10, right: 10, linkSides: true })
    session().undo()
    session().undo()
    expect(activeFrame()).toMatchObject({ left: 7, right: 20, linkSides: false })
    session().patchFrame({ linkVertical: true })
    session().updateFrame('top', 9)
    expect(activeFrame()).toMatchObject({ top: 9, bottom: 9 })
    const snapshot = JSON.parse(JSON.stringify(getSessionSnapshot()))
    useSessionStore.setState(useSessionStore.getInitialState(), true)
    restoreSessionSnapshot(snapshot)
    expect(activeFrame()).toMatchObject({ linkSides: false, linkVertical: true, top: 9, bottom: 9 })
    session().patchFrame({ linkVertical: false })
    expect(activeFrame()).toMatchObject({ top: 8, bottom: 15, linkVertical: false })
  })

  test('keeps linked padding restore values scoped to each photo and edit target', () => {
    session().addToSession([photo('a'), photo('b')])
    session().setEditMode('this')
    session().patchFrame({ linkVertical: true })
    session().updateFrame('top', 6)
    session().setActivePhoto('b')
    session().patchFrame({ top: 13, bottom: 24, linkVertical: false })
    session().patchFrame({ linkVertical: true })
    session().updateFrame('top', 7)
    session().patchFrame({ linkVertical: false })
    expect(session().photos.find(({ id }) => id === 'b')?.overrides).toMatchObject({ top: 13, bottom: 24, linkVertical: false })
    session().setActivePhoto('a')
    session().patchFrame({ linkVertical: false })
    expect(session().photos.find(({ id }) => id === 'a')?.overrides).toMatchObject({ top: 8, bottom: 15, linkVertical: false })
  })

  test('reimporting the same original in a new session does not carry Completed state', () => {
    session().addToSession([photo('same')])
    session().setCompleted('same', true)
    session().finishSession()
    const repeatedOriginal = { ...photo('same-again'), name: 'same.jpg', source: { kind: 'path' as const, path: '/photos/same.jpg', url: '/photos/same.jpg' } }
    session().addToSession([repeatedOriginal])
    expect(session().photos).toHaveLength(1)
    expect(session().photos[0].source.path).toBe('/photos/same.jpg')
    expect(session().photos[0].completed).toBe(false)
  })

  test('restores Custom frame values independently of any palette entries', () => {
    session().addToSession([photo('color')])
    session().patchFrame({ style: 'custom', customColor: '#123ABC' })
    const snapshot = JSON.parse(JSON.stringify(getSessionSnapshot()))
    useSessionStore.setState(useSessionStore.getInitialState(), true)
    restoreSessionSnapshot(snapshot)
    expect(session().commonFrame).toMatchObject({ style: 'custom', customColor: '#123ABC' })
  })

  test('saves and restores Soft Black frame style and its undo history', () => {
    session().addToSession([photo('soft-black')])
    session().updateFrame('style', 'softBlack')
    const snapshot = JSON.parse(JSON.stringify(getSessionSnapshot()))
    useSessionStore.setState(useSessionStore.getInitialState(), true)
    restoreSessionSnapshot(snapshot)
    expect(session().commonFrame.style).toBe('softBlack')
    session().undo()
    expect(session().commonFrame.style).toBe('black')
    session().redo()
    expect(session().commonFrame.style).toBe('softBlack')
  })

  test('finishing a reopened session updates its history and preserves the other workspace as suspended', () => {
    session().addToSession([photo('a'), photo('b')])
    const firstId = session().sessionId
    session().finishSession()
    session().addToSession([photo('c')])

    session().openRecentSession(firstId)
    session().removePhoto('b')
    session().finishSession()

    expect(session().photos).toEqual([])
    expect(session().suspendedSessions[0].photos.map((item) => item.id)).toEqual(['c'])
    expect(session().recentSessions.map((item) => item.id)).toEqual([firstId])
    expect(session().recentSessions[0].photos.map((item) => item.id)).toEqual(['a'])
    expect(session().recentSessions[0].removedPhotos).toEqual([])
  })
})
