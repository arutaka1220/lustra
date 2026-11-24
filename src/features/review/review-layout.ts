export type ReviewTile = { index: number; x: number; y: number; width: number; height: number }
export type ReviewLayout = { mode: 'mosaic' | 'justified'; tiles: ReviewTile[]; height: number }

const DEFAULT_GAP = 10
const TARGET_ROW_HEIGHT = 230
const MAX_ROW_HEIGHT = 420
const MOSAIC_LIMIT = 8

function safeRatios(aspects: number[]) {
  return aspects.map((aspect) => Number.isFinite(aspect) && aspect > 0 ? aspect : 1.5)
}

function tileError(tile: ReviewTile, aspect: number) {
  const tileAspect = tile.width / Math.max(1, tile.height)
  const ratioError = Math.log(tileAspect / aspect)
  const shortSide = Math.min(tile.width, tile.height)
  return ratioError * ratioError + Math.max(0, 150 - shortSide) ** 2 / 22_500
}

/** Bounded guillotine search over ordered splits; each recursive region remains contiguous in session order. */
function buildMosaic(aspects: number[], width: number, height: number, gap: number): ReviewTile[] {
  const memo = new Map<string, { tiles: ReviewTile[]; score: number }>()
  const weight = (start: number, end: number) => aspects.slice(start, end).reduce((sum, ratio) => sum + ratio, 0)
  const solve = (start: number, end: number, x: number, y: number, w: number, h: number): { tiles: ReviewTile[]; score: number } => {
    const key = `${start}:${end}:${Math.round(x)}:${Math.round(y)}:${Math.round(w)}:${Math.round(h)}`
    const cached = memo.get(key)
    if (cached) return cached
    if (end - start === 1) {
      const tile = { index: start, x, y, width: w, height: h }
      const result = { tiles: [tile], score: tileError(tile, aspects[start]) }
      memo.set(key, result)
      return result
    }
    let best: { tiles: ReviewTile[]; score: number } | undefined
    for (let split = start + 1; split < end; split++) {
      const fraction = weight(start, split) / weight(start, end)
      const verticalWidth = w - gap
      if (verticalWidth > 1) {
        const leftWidth = verticalWidth * fraction
        const left = solve(start, split, x, y, leftWidth, h)
        const right = solve(split, end, x + leftWidth + gap, y, verticalWidth - leftWidth, h)
        const candidate = { tiles: [...left.tiles, ...right.tiles], score: left.score + right.score }
        if (!best || candidate.score < best.score) best = candidate
      }
      const verticalHeight = h - gap
      if (verticalHeight > 1) {
        const topHeight = verticalHeight * fraction
        const top = solve(start, split, x, y, w, topHeight)
        const bottom = solve(split, end, x, y + topHeight + gap, w, verticalHeight - topHeight)
        const candidate = { tiles: [...top.tiles, ...bottom.tiles], score: top.score + bottom.score }
        if (!best || candidate.score < best.score) best = candidate
      }
    }
    const result = best ?? { tiles: [], score: Number.POSITIVE_INFINITY }
    memo.set(key, result)
    return result
  }
  return solve(0, aspects.length, 0, 0, width, height).tiles
}

function buildJustified(aspects: number[], width: number, gap: number): ReviewLayout {
  const count = aspects.length
  const cost = Array(count + 1).fill(Number.POSITIVE_INFINITY) as number[]
  const previous = Array(count + 1).fill(-1) as number[]
  const heights = Array(count + 1).fill(TARGET_ROW_HEIGHT) as number[]
  cost[0] = 0
  for (let end = 1; end <= count; end++) {
    let rowAspect = 0
    for (let start = end - 1; start >= 0 && end - start <= 12; start--) {
      rowAspect += aspects[start]
      const rowHeight = (width - gap * (end - start - 1)) / rowAspect
      if (rowHeight <= 0) continue
      const isLast = end === count
      const deviation = Math.log(Math.max(1, rowHeight) / TARGET_ROW_HEIGHT)
      const rowCost = isLast ? deviation * deviation * 0.18 : deviation * deviation
      const candidate = cost[start] + rowCost + 0.035
      if (candidate < cost[end]) {
        cost[end] = candidate
        previous[end] = start
        heights[end] = Math.min(MAX_ROW_HEIGHT, Math.max(1, isLast ? Math.min(TARGET_ROW_HEIGHT, rowHeight) : rowHeight))
      }
    }
  }
  const ranges: Array<[number, number, number]> = []
  let end = count
  while (end > 0) {
    const start = previous[end] >= 0 ? previous[end] : end - 1
    ranges.unshift([start, end, heights[end]])
    end = start
  }
  const tiles: ReviewTile[] = []
  let y = 0
  for (const [start, finish, rowHeight] of ranges) {
    const isLast = finish === count
    const justifiedHeight = (width - gap * (finish - start - 1)) / aspects.slice(start, finish).reduce((sum, aspect) => sum + aspect, 0)
    const scale = isLast ? rowHeight : Math.min(MAX_ROW_HEIGHT, justifiedHeight)
    const rowWidth = aspects.slice(start, finish).reduce((sum, aspect) => sum + aspect * scale, 0) + gap * (finish - start - 1)
    let x = isLast ? Math.max(0, (width - rowWidth) / 2) : 0
    for (let index = start; index < finish; index++) {
      const tileWidth = aspects[index] * scale
      tiles.push({ index, x, y, width: tileWidth, height: scale })
      x += tileWidth + gap
    }
    y += scale + gap
  }
  const totalHeight = y - gap
  return { mode: 'justified', tiles, height: Math.max(1, totalHeight) }
}

export function buildReviewLayout(input: number[], width: number, height: number, gap = DEFAULT_GAP): ReviewLayout {
  if (!input.length || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return { mode: 'mosaic', tiles: [], height: 0 }
  const aspects = safeRatios(input)
  if (aspects.length <= MOSAIC_LIMIT) {
    const tiles = buildMosaic(aspects, Math.max(1, width - 2), Math.max(1, height - 2), gap)
    return { mode: 'mosaic', tiles, height }
  }
  return buildJustified(aspects, width, gap)
}
