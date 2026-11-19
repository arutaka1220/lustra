export type RGB = { r: number; g: number; b: number }
const byte = (n: number) => Math.max(0, Math.min(255, Math.round(Number.isFinite(n) ? n : 0)))
export function parseHex(value: string): string | null {
  const hex = value.trim().replace(/^#/, '')
  return /^[\da-f]{6}$/i.test(hex) ? `#${hex.toUpperCase()}` : null
}
export function hexToRgb(value: string): RGB | null {
  const hex = parseHex(value)
  return hex ? { r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16) } : null
}
export function rgbToHex({ r, g, b }: RGB) { return `#${[r, g, b].map(n => byte(n).toString(16).padStart(2, '0')).join('').toUpperCase()}` }
export function rgbToHsv({ r, g, b }: RGB) {
  const values = [r, g, b].map(v => byte(v) / 255), max = Math.max(...values), min = Math.min(...values), delta = max - min
  let h = 0
  if (delta) h = max === values[0] ? ((values[1] - values[2]) / delta) % 6 : max === values[1] ? (values[2] - values[0]) / delta + 2 : (values[0] - values[1]) / delta + 4
  return { h: ((h * 60 + 360) % 360), s: max ? delta / max * 100 : 0, v: max * 100 }
}
export function hsvToHex(h: number, s: number, v: number) {
  const c = v / 100 * s / 100, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v / 100 - c
  const sector = ((Math.floor(h / 60) % 6) + 6) % 6
  const rgb = [[c,x,0],[x,c,0],[0,c,x],[0,x,c],[x,0,c],[c,0,x]][sector]
  return rgbToHex({ r: (rgb[0] + m) * 255, g: (rgb[1] + m) * 255, b: (rgb[2] + m) * 255 })
}
