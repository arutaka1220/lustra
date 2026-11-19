import { create } from 'zustand'
import { readAppPreference, writeAppPreference } from '../../store/session-persistence'
import type { MetadataField } from './text-model'

export type MetadataFocus = { photoId: string; field: MetadataField }
type EditorStore = {
  selection: { photoId: string; ids: string[] } | null
  metadataFocus: MetadataFocus | null
  guidesEnabled: boolean
  select: (photoId: string, ids: string[]) => void
  focusMetadata: (focus: MetadataFocus) => void
  clearMetadataFocus: (focus: MetadataFocus) => void
  loadGuides: () => Promise<void>
  setGuidesEnabled: (enabled: boolean) => void
}

const GUIDES_KEY = 'editor.smart-guides'
let guidesLoaded = false
let guidesModified = false
const NO_TEXT_SELECTION: string[] = []

export const useTextEditor = create<EditorStore>((set) => ({
  selection: null,
  metadataFocus: null,
  guidesEnabled: localStorage.getItem('lustra.smart-guides') !== 'false',
  select: (photoId, ids) => set({ selection: { photoId, ids } }),
  focusMetadata: (metadataFocus) => set({ metadataFocus }),
  clearMetadataFocus: (focus) => set((state) => state.metadataFocus === focus ? { metadataFocus: null } : state),
  loadGuides: async () => {
    if (guidesLoaded) return
    guidesLoaded = true
    try {
      const saved = await readAppPreference<boolean>(GUIDES_KEY)
      if (typeof saved === 'boolean' && !guidesModified) set({ guidesEnabled: saved })
    } catch {
      guidesLoaded = false
    }
  },
  setGuidesEnabled: (guidesEnabled) => {
    guidesModified = true
    localStorage.setItem('lustra.smart-guides', String(guidesEnabled))
    void writeAppPreference(GUIDES_KEY, guidesEnabled).catch(() => undefined)
    set({ guidesEnabled })
  },
}))

export function useSelectedTextIds(photoId: string) {
  return useTextEditor((state) => state.selection?.photoId === photoId ? state.selection.ids : NO_TEXT_SELECTION)
}
