import { beforeEach, describe, expect, test } from 'bun:test'
import { getSessionSnapshot, restoreSessionSnapshot, useSessionStore } from '../src/store/session-store'
import type { ImportCandidate } from '../src/types/photo'

function photo(id: string): ImportCandidate {
  const name = `${id}.jpg`
  const path = `/photos/${name}`
  return { id, name, source: { kind: 'path', path, url: path }, selected: true, metadata: {}, metadataState: 'ready' }
}

const session = useSessionStore.getState

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

    expect(session().commonFrame.top).toBe(4)
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

    expect(session().commonFrame).toMatchObject({ bottom: 24 })
    expect(session().photos[0].metadataState).toBe('loading')
    expect(session().commonFrame).not.toHaveProperty('ratio')
    expect(session().commonFrame).not.toHaveProperty('fit')
    expect(session().photos[0]).not.toHaveProperty('crop')
    expect(session().photos[0].overrides).toEqual({ left: 12, right: 12 })
    expect(session().history.common.undo.at(-1)?.change).toMatchObject({
      kind: 'common', values: { keys: ['bottom'] },
    })

    session().undo()
    expect(session().commonFrame.bottom).toBe(15)
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
