import { beforeEach, describe, expect, test } from 'bun:test'
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
    expect(getSessionSnapshot().version).toBe(2)
    expect(session().commonFrame.style).toBe('softWhite')
    expect(session().photos[0].overrides.style).toBe('softWhite')
    expect(session().history.common.undo.at(-1)?.change).toMatchObject({ kind: 'common', values: { before: { style: 'black' }, after: { style: 'softWhite' } } })
    session().undo()
    expect(session().photos[0].overrides.style).toBeUndefined()
  })

  test('writes the current archive version and rejects unsupported versions without changing the store', () => {
    session().addToSession([photo('versioned')])
    const current = getSessionSnapshot()
    expect(current.version).toBe(2)

    const before = session().photos
    expect(() => restoreSessionSnapshot({ ...current, version: 3 })).toThrow('This session archive requires a newer version of Lustra.')
    expect(session().photos).toBe(before)
    expect(() => restoreSessionSnapshot({ ...current, version: 0 })).toThrow('This session archive is invalid or damaged.')
  })

  test('survives three serialized restart cycles with photo, frame, text, padding, color, and completion intact', () => {
    session().addToSession([photo('restart')])
    session().setScreen('edit')
    session().patchFrame({
      style: 'custom', customColor: '#123ABC', top: 12, bottom: 24, left: 9, right: 9,
      textElements: [{ id: 'title', template: 'Lustra test', anchor: 'bottom-left', x: 34, y: -18, size: 20, fontFamily: 'Arial', weight: 400, color: '#123ABC', visible: true }],
    })
    session().setCompleted('restart', true)

    for (let restart = 0; restart < 3; restart += 1) {
      const archived = JSON.parse(JSON.stringify(getSessionSnapshot()))
      useSessionStore.setState(useSessionStore.getInitialState(), true)
      restoreSessionSnapshot(archived)
      expect(getSessionSnapshot().version).toBe(2)
      expect(session().screen).toBe('edit')
      expect(session().photos).toHaveLength(1)
      expect(session().photos[0].completed).toBe(true)
      expect(session().commonFrame).toMatchObject({ style: 'custom', customColor: '#123ABC' })
      expect(activeFrame()).toMatchObject({ top: 12, bottom: 24, left: 9, right: 9 })
      expect(session().commonFrame.textElements?.[0]).toMatchObject({ template: 'Lustra test', color: '#123ABC' })
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

  test('finishing a reopened session updates its history item and brings back the parked work', () => {
    session().addToSession([photo('a'), photo('b')])
    const firstId = session().sessionId
    session().finishSession()
    session().addToSession([photo('c')])

    session().openRecentSession(firstId)
    session().removePhoto('b')
    session().finishSession()

    expect(session().photos.map((item) => item.id)).toEqual(['c'])
    expect(session().recentSessions.map((item) => item.id)).toEqual([firstId])
    expect(session().recentSessions[0].photos.map((item) => item.id)).toEqual(['a'])
    expect(session().recentSessions[0].removedPhotos).toEqual([])
  })
})
