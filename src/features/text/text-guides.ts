export type TextBounds = { x: number; y: number; width: number; height: number }

const SNAP_DISTANCE = 6

function getAxisRange(bounds: TextBounds, horizontal: boolean): [number, number] {
  const from = horizontal ? bounds.x : bounds.y
  return [from, from + (horizontal ? bounds.width : bounds.height)]
}

function getAlignmentPoints([start, end]: [number, number]) {
  return [start, (start + end) / 2, end]
}

function getEqualSpacingStarts(bounds: TextBounds[], moving: TextBounds, horizontal: boolean) {
  const [movingStart, movingEnd] = getAxisRange(moving, horizontal)
  const [crossStart, crossEnd] = getAxisRange(moving, !horizontal)
  const size = movingEnd - movingStart
  const ranges = bounds.filter((bounds) => {
    const [start, end] = getAxisRange(bounds, !horizontal)
    return crossStart < end && crossEnd > start
  }).map((bounds) => getAxisRange(bounds, horizontal)).sort(([a], [b]) => a - b)

  const positions: number[] = []
  for (let index = 1; index < ranges.length; index += 1) {
    const [leftStart, leftEnd] = ranges[index - 1]
    const [rightStart, rightEnd] = ranges[index]
    const gap = rightStart - leftEnd
    if (gap < 0) continue
    positions.push(leftStart - gap - size, rightEnd + gap)
    if (gap >= size) positions.push(leftEnd + (gap - size) / 2)
  }
  return positions
}

function snapAxis(moving: TextBounds, stationary: TextBounds[], references: TextBounds[], horizontal: boolean) {
  const range = getAxisRange(moving, horizontal)
  const movingPoints = getAlignmentPoints(range)
  const alignments = [...references, ...stationary].flatMap((box) => getAlignmentPoints(getAxisRange(box, horizontal)))
  let result: { shift: number; guide: number } | null = null
  const consider = (point: number, target: number) => {
    const shift = target - point
    if (Math.abs(shift) >= Math.abs(result?.shift ?? SNAP_DISTANCE)) return
    result = { shift, guide: target }
  }

  for (const target of alignments) {
    for (const point of movingPoints) consider(point, target)
  }
  for (const target of getEqualSpacingStarts(stationary, moving, horizontal)) {
    consider(range[0], target)
  }
  return result as { shift: number; guide: number } | null
}

export function findTextGuides(
  moving: TextBounds,
  stationary: TextBounds[],
  canvas: TextBounds,
  image: TextBounds | undefined,
) {
  const references = image ? [canvas, image] : [canvas]
  return {
    horizontal: snapAxis(moving, stationary, references, true),
    vertical: snapAxis(moving, stationary, references, false),
  }
}
