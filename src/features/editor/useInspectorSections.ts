import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { readAppPreference, writeAppPreference } from '../../store/session-persistence'

export type InspectorSectionId = 'canvas' | 'frame' | 'padding' | 'effects' | 'text' | 'typography' | 'guides'

type SectionState = Record<InspectorSectionId, boolean>

const STORAGE_KEY = 'lustra.inspector-sections'
const PREF_KEY = 'editor.inspector-sections'
const DEFAULT_SECTIONS: SectionState = {
  canvas: true,
  frame: true,
  padding: true,
  effects: false,
  text: false,
  typography: false,
  guides: false,
}

function normalizeSections(saved: Partial<SectionState> | null): SectionState {
  const normalized = { ...DEFAULT_SECTIONS }
  for (const id of Object.keys(DEFAULT_SECTIONS) as InspectorSectionId[]) {
    const value = saved?.[id]
    if (typeof value === 'boolean') normalized[id] = value
  }
  return normalized
}

function readLegacySections(): Partial<SectionState> | null {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<SectionState> | null
  } catch {
    return null
  }
}

let sections = normalizeSections(readLegacySections())
let loaded = false
let edited = false
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function publish(next: SectionState) {
  sections = next
  listeners.forEach((listener) => listener())
}

function saveSections(next: SectionState) {
  void writeAppPreference(PREF_KEY, next).catch((error) => console.warn('Could not save inspector sections', error))
}

function loadSections() {
  if (loaded) return
  loaded = true
  void readAppPreference<Partial<SectionState>>(PREF_KEY).then((saved) => {
    if (edited) return
    const legacy = saved === null ? readLegacySections() : null
    const next = normalizeSections(saved ?? legacy)
    publish(next)
    if (legacy) saveSections(next)
  }).catch((error) => console.warn('Could not restore inspector sections', error))
}

function setOpen(section: InspectorSectionId, open: boolean) {
  if (sections[section] === open) return
  edited = true
  const next = { ...sections, [section]: open }
  publish(next)
  saveSections(next)
}

const toggle = (section: InspectorSectionId) => setOpen(section, !sections[section])
const open = (section: InspectorSectionId) => setOpen(section, true)

export function useInspectorSections() {
  const current = useSyncExternalStore(subscribe, () => sections)
  useEffect(loadSections, [])
  const isOpen = useCallback((section: InspectorSectionId) => current[section], [current])
  return { isOpen, toggle, open }
}
