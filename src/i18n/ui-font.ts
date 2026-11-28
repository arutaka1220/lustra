export const JAPANESE_UI_FONTS = ['noto', 'line-seed', 'm-plus', 'hiragino', 'gen-interface'] as const
export type JapaneseUiFont = (typeof JAPANESE_UI_FONTS)[number]

const FONT_FAMILY: Record<JapaneseUiFont, string> = {
  noto: 'Noto Sans JP Variable',
  'line-seed': 'LINE Seed JP',
  'm-plus': 'M PLUS 1 Variable',
  hiragino: 'Hiragino Sans',
  'gen-interface': 'Gen Interface JP',
}

let devFontsLoaded: Promise<void> | null = null

async function loadComparisonFonts(): Promise<void> {
  if (!import.meta.env.DEV) return
  devFontsLoaded ??= import('../styles/dev-fonts.css').then(() => undefined)
  await devFontsLoaded
}

function macHasFont(family: string): boolean {
  if (!/Mac|iPhone|iPad/.test(navigator.userAgent)) return false
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context) return false
  const sample = '日本語の可読性を確認するABC123'
  context.font = `32px "${family}", monospace`
  const candidate = context.measureText(sample).width
  context.font = '32px monospace'
  return candidate !== context.measureText(sample).width
}

export async function isJapaneseUiFontAvailable(font: JapaneseUiFont): Promise<boolean> {
  if (font === 'noto') return true
  if (font === 'hiragino') return macHasFont(FONT_FAMILY.hiragino)
  await loadComparisonFonts()
  await document.fonts.load(`400 16px "${FONT_FAMILY[font]}"`, '日本語')
  return document.fonts.check(`400 16px "${FONT_FAMILY[font]}"`, '日本語')
}

export async function applyJapaneseUiFont(font: JapaneseUiFont): Promise<JapaneseUiFont> {
  const available = await isJapaneseUiFontAvailable(font)
  const resolved = available ? font : 'noto'
  document.documentElement.dataset.japaneseFont = resolved
  return resolved
}

export function isJapaneseUiFont(value: unknown): value is JapaneseUiFont {
  return typeof value === 'string' && JAPANESE_UI_FONTS.some((font) => font === value)
}
