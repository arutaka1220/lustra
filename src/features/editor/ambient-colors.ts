export type AmbientColorSource = 'fullImage' | 'edges'

export type AmbientSample = { color: string; x: number; y: number; weight: number }

/** Dominant 3-bit RGB bins from a bounded RGBA sample. */
export function extractAmbientColors(data: Uint8ClampedArray | Uint8Array, width: number, height: number, source: AmbientColorSource): string[] {
  return extractAmbientSamples(data, width, height, source).map(sample => sample.color)
}

/** Bounded histogram with spatial centroids; output order is deterministic. */
export function extractAmbientSamples(data: Uint8ClampedArray | Uint8Array, width: number, height: number, source: AmbientColorSource): AmbientSample[] {
  const bins = new Map<number, { count: number; r: number; g: number; b: number; x: number; y: number; vivid: number }>()
  const marginX = Math.floor(width * 8 / 48), marginY = Math.floor(height * 8 / 48)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (source === 'edges' && x > marginX && x < width - marginX - 1 && y > marginY && y < height - marginY - 1) continue
    const i = (y * width + x) * 4
    const key = ((data[i] >> 5) << 6) | ((data[i + 1] >> 5) << 3) | (data[i + 2] >> 5)
    const bin = bins.get(key) ?? { count: 0, r: 0, g: 0, b: 0, x: 0, y: 0, vivid: 0 }
    const r = data[i], g = data[i + 1], b = data[i + 2]
    bin.count++; bin.r += r; bin.g += g; bin.b += b; bin.x += x; bin.y += y
    bin.vivid += Math.max(r, g, b) - Math.min(r, g, b)
    bins.set(key, bin)
  }
  const all = [...bins.values()].filter(bin => bin.count)
  if (!all.length) return []
  const maxCount = Math.max(...all.map(bin => bin.count))
  // Rank by prevalence with a restrained chroma bonus so tiny highlights/noise
  // cannot dominate while characteristic colors survive large dark regions.
  const ranked = all.sort((a, b) => score(b) - score(a))
  function score(bin: typeof all[number]) {
    const prevalence = Math.sqrt(bin.count / maxCount)
    const chroma = bin.vivid / (bin.count * 255)
    const lightness = (bin.r + bin.g + bin.b) / (bin.count * 765)
    return prevalence * (0.78 + Math.min(0.22, chroma * 0.55) + Math.min(0.06, lightness * 0.06))
  }
  const selected: typeof all = []
  for (const bin of ranked) {
    const color = [bin.r / bin.count, bin.g / bin.count, bin.b / bin.count]
    if (selected.some(other => {
      const o = [other.r / other.count, other.g / other.count, other.b / other.count]
      return Math.hypot(color[0] - o[0], color[1] - o[1], color[2] - o[2]) < 48
    })) continue
    selected.push(bin)
    if (selected.length === 5) break
  }
  return selected.map(bin => ({
    color: `rgb(${Math.round(bin.r / bin.count)},${Math.round(bin.g / bin.count)},${Math.round(bin.b / bin.count)})`,
    x: bin.x / bin.count / Math.max(1, width - 1), y: bin.y / bin.count / Math.max(1, height - 1),
    weight: bin.count / (width * height),
  }))
}
