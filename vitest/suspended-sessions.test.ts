import { beforeEach, describe, expect, it } from 'vitest'
import { getSessionSnapshot, restoreSessionSnapshot, useSessionStore } from '../src/store/session-store'
import type { ImportCandidate } from '../src/types/photo'

function candidate(id: string): ImportCandidate {
  const path = `/photos/${id}.jpg`
  return { id, name: `${id}.jpg`, source: { kind: 'path', path, url: path }, selected: true, metadata: {}, metadataState: 'ready' }
}

beforeEach(() => useSessionStore.setState(useSessionStore.getInitialState(), true))

describe('suspended editing sessions', () => {
  it('suspends without finishing and resumes the same session with edits and undo history', () => {
    const store = useSessionStore.getState()
    store.addToSession([candidate('one')])
    store.patchFrame({ top: 19 })
    const originalId = useSessionStore.getState().sessionId
    const suspendedId = useSessionStore.getState().suspendCurrentSession()

    expect(suspendedId).toBe(originalId)
    expect(useSessionStore.getState().photos).toHaveLength(0)
    expect(useSessionStore.getState().recentSessions).toHaveLength(0)
    expect(useSessionStore.getState().suspendedSessions).toHaveLength(1)

    useSessionStore.getState().resumeSuspendedSession(originalId)
    const resumed = useSessionStore.getState()
    expect(resumed.sessionId).toBe(originalId)
    expect(resumed.photos).toHaveLength(1)
    expect(resumed.commonFrame.aspectPadding?.['other:unknown']?.top).toBe(19)
    expect(resumed.history.common.undo).toHaveLength(2)
    expect(resumed.suspendedSessions).toHaveLength(0)
  })

  it('keeps multiple suspended sessions beyond the recent history limit and restores them from archives', () => {
    useSessionStore.getState().setRecentLimit(1)
    const ids: string[] = []
    for (const name of ['a', 'b', 'c']) {
      useSessionStore.getState().addToSession([candidate(name)])
      ids.push(useSessionStore.getState().sessionId)
      useSessionStore.getState().suspendCurrentSession()
    }
    expect(useSessionStore.getState().suspendedSessions.map(({ id }) => id)).toEqual([...ids].reverse())
    const snapshot = getSessionSnapshot()
    useSessionStore.setState(useSessionStore.getInitialState(), true)
    restoreSessionSnapshot(snapshot)
    expect(useSessionStore.getState().suspendedSessions.map(({ id }) => id)).toEqual([...ids].reverse())
    expect(useSessionStore.getState().recentSessions).toHaveLength(0)
  })

  it('migrates a version 2 parked workspace into the suspended list', () => {
    useSessionStore.getState().addToSession([candidate('legacy-parked')])
    useSessionStore.getState().suspendCurrentSession()
    const archive = getSessionSnapshot() as any
    archive.version = 2
    archive.parked = archive.suspended[0]
    delete archive.suspended

    useSessionStore.setState(useSessionStore.getInitialState(), true)
    restoreSessionSnapshot(archive)
    const restored = useSessionStore.getState()
    expect(restored.parkedSession).toBeNull()
    expect(restored.suspendedSessions).toHaveLength(1)
    expect(restored.suspendedSessions[0].photos[0].name).toBe('legacy-parked.jpg')
  })

  it('imports into an independent fresh workspace while preserving the suspended session', () => {
    const previous = candidate('shared-source')
    useSessionStore.getState().addToSession([previous])
    useSessionStore.getState().setCompleted(previous.id, true)
    const suspendedId = useSessionStore.getState().sessionId
    useSessionStore.getState().suspendCurrentSession()
    const next = candidate('shared-source')
    useSessionStore.getState().addToSession([next])

    const state = useSessionStore.getState()
    expect(state.sessionId).not.toBe(suspendedId)
    expect(state.photos[0].completed).toBe(false)
    expect(state.suspendedSessions[0].photos[0].completed).toBe(true)
  })
})
