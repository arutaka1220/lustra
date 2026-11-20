import { beforeEach, describe, expect, it } from 'vitest'
import { getEffectiveFrame, getSessionSnapshot, initialFrame, restoreSessionSnapshot, useSessionStore } from '../src/store/session-store'
import type { ImportCandidate } from '../src/types/photo'

function candidate(id: string): ImportCandidate {
  const path = `/photos/${id}.jpg`
  return { id, name: `${id}.jpg`, source: { kind: 'path', path, url: path }, selected: true, metadata: {}, metadataState: 'ready' }
}

beforeEach(() => useSessionStore.setState(useSessionStore.getInitialState(), true))

describe('aspect-specific padding state', () => {
  it('applies shared padding only to photos in the selected source ratio group and supports undo', () => {
    const wide = candidate('wide')
    const portrait = candidate('portrait')
    useSessionStore.getState().addToSession([wide, portrait])
    useSessionStore.getState().setCandidateMetadata('wide', {}, 'ready', wide.source, { imageWidth: 2048, imageHeight: 1362 })
    useSessionStore.getState().setCandidateMetadata('portrait', {}, 'ready', portrait.source, { imageWidth: 1200, imageHeight: 1800 })

    useSessionStore.getState().setActivePhoto(wide.id)
    useSessionStore.getState().patchFrame({ top: 12 })

    const state = useSessionStore.getState()
    expect(getEffectiveFrame(state.photos[0], state.commonFrame).top).toBe(12)
    expect(getEffectiveFrame(state.photos[1], state.commonFrame).top).toBe(initialFrame.top)
    useSessionStore.getState().undo()
    expect(getEffectiveFrame(useSessionStore.getState().photos[0], useSessionStore.getState().commonFrame).top).toBe(initialFrame.top)
  })

  it('keeps This Photo edits separate from the shared ratio settings', () => {
    const wide = candidate('wide')
    const secondWide = candidate('second-wide')
    useSessionStore.getState().addToSession([wide, secondWide])
    for (const photo of [wide, secondWide]) {
      useSessionStore.getState().setCandidateMetadata(photo.id, {}, 'ready', photo.source, { imageWidth: 2048, imageHeight: 1362 })
    }
    useSessionStore.getState().setEditMode('this')
    useSessionStore.getState().patchFrame({ bottom: 24 })

    const state = useSessionStore.getState()
    expect(state.commonFrame.aspectPadding?.['3:2']).toBeUndefined()
    expect(getEffectiveFrame(state.photos[0], state.commonFrame).bottom).toBe(24)
    expect(getEffectiveFrame(state.photos[1], state.commonFrame).bottom).toBe(initialFrame.bottom)
  })

  it('round-trips dimensions and ratio padding through session persistence', () => {
    const wide = candidate('wide')
    useSessionStore.getState().addToSession([wide])
    useSessionStore.getState().setCandidateMetadata(wide.id, {}, 'ready', wide.source, { imageWidth: 2048, imageHeight: 1362 })
    useSessionStore.getState().setActivePhoto(wide.id)
    useSessionStore.getState().patchFrame({ left: 11, right: 11 })
    const snapshot = getSessionSnapshot()

    useSessionStore.setState(useSessionStore.getInitialState(), true)
    restoreSessionSnapshot(snapshot)
    const restored = useSessionStore.getState()
    expect(restored.photos[0].imageWidth).toBe(2048)
    expect(restored.commonFrame.aspectPadding?.['3:2']).toMatchObject({ left: 11, right: 11 })
    expect(getEffectiveFrame(restored.photos[0], restored.commonFrame).left).toBe(11)
  })
})
