export type EdgeMode = 'extend' | 'mirror'

/** Map a canvas pixel to the visible-photo pixel whose edge continues into padding. */
export function edgeSampleCoordinate(value: number, start: number, end: number, mode: EdgeMode): number {
  if (end <= start) return start
  if (value >= start && value <= end) return value
  if (mode === 'extend') return value < start ? start : end
  const span = end - start
  const distance = value < start ? start - value : value - end
  const folded = distance % (span * 2)
  const reflected = folded <= span ? folded : span * 2 - folded
  return value < start ? start + reflected : end - reflected
}

export function edgeFadeWeight(distance: number, fade: number): number {
  if (fade <= 0) return 0
  const t = Math.max(0, Math.min(1, 1 - distance / fade))
  return t * t * (3 - 2 * t)
}
