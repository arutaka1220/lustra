export type JustifiedRow = { indices: number[]; height: number; widths: number[] }

/** Greedily groups images into near-uniform rows; the incomplete last row stays natural-width. */
export function buildJustifiedRows(aspects: number[], width: number, gap = 10, targetHeight = 230): JustifiedRow[] {
  if (width <= 0 || aspects.length === 0) return []
  const ratios = aspects.map((aspect) => Number.isFinite(aspect) && aspect > 0 ? aspect : 1.5)
  const rows: JustifiedRow[] = []
  let current: number[] = []
  const predictedHeight = (indices: number[]) => (width - gap * Math.max(0, indices.length - 1)) / indices.reduce((sum, index) => sum + ratios[index], 0)
  const finish = (last: boolean) => {
    if (!current.length) return
    const fullHeight = predictedHeight(current)
    const height = last ? Math.min(targetHeight, fullHeight) : fullHeight
    rows.push({ indices: current, height, widths: current.map((index) => ratios[index] * height) })
    current = []
  }

  ratios.forEach((_, index) => {
    current.push(index)
    if (predictedHeight(current) >= targetHeight) return
    if (current.length > 1) {
      const lastIndex = current.pop()!
      const previousIsCloser = Math.abs(predictedHeight(current) - targetHeight) <= Math.abs(predictedHeight([...current, lastIndex]) - targetHeight)
      if (previousIsCloser) {
        finish(false)
        current.push(lastIndex)
      } else {
        current.push(lastIndex)
        finish(false)
      }
    } else {
      finish(false)
    }
  })
  finish(true)
  return rows
}
