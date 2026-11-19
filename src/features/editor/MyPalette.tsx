import { useEffect, useState } from 'react'
import { parseHex } from './color-utils'

const STORAGE_KEY = 'lustra.myPalette'
export const MAX_PALETTE_COLORS = 16

export function normalizePalette(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const colors: string[] = []
  for (const entry of value) {
    if (typeof entry !== 'string') continue
    const color = parseHex(entry)
    if (color && !colors.includes(color) && colors.length < MAX_PALETTE_COLORS) colors.push(color)
  }
  return colors
}

export function loadPalette(): string[] {
  try { return normalizePalette(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')) } catch { return [] }
}

export function savePalette(colors: string[]) {
  const normalized = normalizePalette(colors)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized))
  return normalized
}

export function useMyPalette() {
  const [palette, setPalette] = useState(loadPalette)
  useEffect(() => {
    const refresh = () => setPalette(loadPalette())
    window.addEventListener('storage', refresh)
    return () => window.removeEventListener('storage', refresh)
  }, [])
  const update = (next: string[]) => setPalette(savePalette(next))
  return [palette, update] as const
}
