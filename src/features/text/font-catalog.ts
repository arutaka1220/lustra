import { invoke, isTauri } from '@tauri-apps/api/core'
import { DEFAULT_TEXT_FONT } from './text-model'

export const SUGGESTED_FONTS = [
  DEFAULT_TEXT_FONT, 'Avenir Next', 'Georgia', 'Helvetica Neue', 'Hiragino Sans',
  'Segoe UI', 'Times New Roman', 'Yu Gothic',
]

let catalog: Promise<string[]> | null = null

export function loadFontCatalog() {
  if (!isTauri()) return Promise.resolve(SUGGESTED_FONTS)
  catalog ??= invoke<string[]>('list_font_families').then(
    (families) => families.length > 0 ? families : SUGGESTED_FONTS,
    () => {
      catalog = null
      return SUGGESTED_FONTS
    },
  )
  return catalog
}
