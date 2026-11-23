export type AmbientColorSource = 'fullImage' | 'edges'

/** Dominant 3-bit RGB bins from a bounded RGBA sample. */
export function extractAmbientColors(data: Uint8ClampedArray | Uint8Array, width: number, height: number, source: AmbientColorSource): string[] {
  const bins = new Map<number, { count: number; r: number; g: number; b: number }>()
  const marginX = Math.floor(width * 8 / 48), marginY = Math.floor(height * 8 / 48)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (source === 'edges' && x > marginX && x < width - marginX - 1 && y > marginY && y < height - marginY - 1) continue
    const i = (y * width + x) * 4
    const key = ((data[i] >> 5) << 6) | ((data[i + 1] >> 5) << 3) | (data[i + 2] >> 5)
    const bin = bins.get(key) ?? { count: 0, r: 0, g: 0, b: 0 }
    bin.count++; bin.r += data[i]; bin.g += data[i + 1]; bin.b += data[i + 2]; bins.set(key, bin)
  }
  return [...bins.values()].sort((a, b) => b.count - a.count).slice(0, 5)
    .map(({ count, r, g, b }) => `rgb(${Math.round(r / count)},${Math.round(g / count)},${Math.round(b / count)})`)
}
