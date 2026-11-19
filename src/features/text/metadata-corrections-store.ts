import { create } from 'zustand'
import { readMetadataCorrections, writeMetadataCorrections } from '../../store/session-persistence'
import { EMPTY_METADATA_CORRECTIONS } from './text-model'
import type { MetadataCorrectionRule, MetadataCorrectionsState } from './text-model'

type Store = {
  corrections: MetadataCorrectionsState
  status: 'idle' | 'loading' | 'ready' | 'loadError'
  saveError: boolean
  load: () => Promise<void>
  setRules: (category: keyof MetadataCorrectionsState, rules: MetadataCorrectionRule[]) => void
  save: () => Promise<void>
}

let pendingSave = Promise.resolve()

export const useMetadataCorrections = create<Store>((set, get) => ({
  corrections: EMPTY_METADATA_CORRECTIONS,
  status: 'idle',
  saveError: false,
  load: async () => {
    if (get().status === 'ready' || get().status === 'loading') return
    set({ status: 'loading' })
    try {
      const saved = await readMetadataCorrections<MetadataCorrectionsState>()
      set({ corrections: saved ?? EMPTY_METADATA_CORRECTIONS, status: 'ready' })
    } catch {
      set({ status: 'loadError' })
    }
  },
  setRules: (category, rules) => {
    if (get().status !== 'ready') return
    set((state) => ({ corrections: { ...state.corrections, [category]: rules } }))
    void get().save()
  },
  save: () => {
    const corrections = get().corrections
    pendingSave = pendingSave.then(async () => {
      try {
        await writeMetadataCorrections(corrections)
        set({ saveError: false })
      } catch {
        set({ saveError: true })
      }
    })
    return pendingSave
  },
}))
