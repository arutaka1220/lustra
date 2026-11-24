export type ReviewTile = { index: number; x: number; y: number; width: number; height: number }
export type ReviewLayout = { mode: 'mosaic' | 'justified'; tiles: ReviewTile[]; height: number }

const GAP = 10
export const DEFAULT_REVIEW_MIN_SIZE = 240
const MOSAIC_LIMIT = 8
const FIT_ITERATIONS = 20

function normalize(aspects: number[]) {
  return aspects.map((aspect) => Number.isFinite(aspect) && aspect > 0 ? aspect : 1.5)
}

type Candidate = { tiles: ReviewTile[]; height: number; score: number }

type Tree = { index: number; aspect: number } | { axis: 'row' | 'column'; left: Tree; right: Tree; aspect: number }
type Shape = { width: number; height: number; tiles: Array<{ index: number; x: number; y: number; width: number; height: number }> }

function makeTree(aspects: number[], start: number, end: number, target: number, cache = new Map<string, Tree>()): Tree {
  if (end - start === 1) return { index: start, aspect: aspects[start] }
  const key = `${start}:${end}:${Math.round(target * 100)}`
  const cached = cache.get(key)
  if (cached) return cached
  const totalWeight = aspects.slice(start, end).reduce((sum, ratio) => sum + ratio, 0)
  let best: Tree | undefined
  let bestError = Number.POSITIVE_INFINITY
  for (let split = start + 1; split < end; split++) {
    const leftCount = split - start
    const rightCount = end - split
    const leftWeight = aspects.slice(start, split).reduce((sum, ratio) => sum + ratio, 0)
    const rightWeight = totalWeight - leftWeight
    const leftRow = makeTree(aspects, start, split, target * leftCount / (end - start) * 1.1, cache)
    const rightRow = makeTree(aspects, split, end, target * rightCount / (end - start) * 1.1, cache)
    const row: Tree = { axis: 'row', left: leftRow, right: rightRow, aspect: leftRow.aspect + rightRow.aspect }
    const rowError = Math.abs(Math.log(row.aspect / target))
    if (rowError < bestError) { best = row; bestError = rowError }

    const leftColumn = makeTree(aspects, start, split, target * totalWeight / leftWeight, cache)
    const rightColumn = makeTree(aspects, split, end, target * totalWeight / rightWeight, cache)
    const columnAspect = 1 / (1 / leftColumn.aspect + 1 / rightColumn.aspect)
    const column: Tree = { axis: 'column', left: leftColumn, right: rightColumn, aspect: columnAspect }
    const columnError = Math.abs(Math.log(columnAspect / target))
    if (columnError < bestError) { best = column; bestError = columnError }
  }
  cache.set(key, best!)
  return best!
}

function layoutAtHeight(tree: Tree, height: number, gap: number): Shape {
  if ('index' in tree) return { width: tree.aspect * height, height, tiles: [{ index: tree.index, x: 0, y: 0, width: tree.aspect * height, height }] }
  if (tree.axis === 'row') {
    const left = layoutAtHeight(tree.left, height, gap), right = layoutAtHeight(tree.right, height, gap)
    return { width: left.width + gap + right.width, height, tiles: [...left.tiles, ...right.tiles.map((tile) => ({ ...tile, x: tile.x + left.width + gap }))] }
  }
  let low = 0, high = Math.max(1, height * tree.aspect)
  for (let i = 0; i < FIT_ITERATIONS; i++) {
    const width = (low + high) / 2
    const left = layoutAtWidth(tree.left, width, gap), right = layoutAtWidth(tree.right, width, gap)
    if (left.height + gap + right.height <= height) low = width
    else high = width
  }
  const left = layoutAtWidth(tree.left, low, gap), right = layoutAtWidth(tree.right, low, gap)
  return { width: low, height: left.height + gap + right.height, tiles: [...left.tiles, ...right.tiles.map((tile) => ({ ...tile, y: tile.y + left.height + gap }))] }
}

function layoutAtWidth(tree: Tree, width: number, gap: number): Shape {
  if ('index' in tree) return { width, height: width / tree.aspect, tiles: [{ index: tree.index, x: 0, y: 0, width, height: width / tree.aspect }] }
  if (tree.axis === 'column') {
    const left = layoutAtWidth(tree.left, width, gap), right = layoutAtWidth(tree.right, width, gap)
    return { width, height: left.height + gap + right.height, tiles: [...left.tiles, ...right.tiles.map((tile) => ({ ...tile, y: tile.y + left.height + gap }))] }
  }
  let low = 0, high = Math.max(1, width / tree.aspect)
  for (let i = 0; i < FIT_ITERATIONS; i++) {
    const height = (low + high) / 2
    const left = layoutAtHeight(tree.left, height, gap), right = layoutAtHeight(tree.right, height, gap)
    if (left.width + gap + right.width <= width) low = height
    else high = height
  }
  const left = layoutAtHeight(tree.left, low, gap), right = layoutAtHeight(tree.right, low, gap)
  return { width: left.width + gap + right.width, height: low, tiles: [...left.tiles, ...right.tiles.map((tile) => ({ ...tile, x: tile.x + left.width + gap }))] }
}

/** Evaluates exact-ratio row/column trees; every leaf rectangle is the photo rectangle. */
function buildSmallMosaic(aspects: number[], width: number, height: number, gap: number): Candidate | undefined {
  if (aspects.length === 1) {
    const scale = Math.min(height, width / aspects[0])
    const tileWidth = aspects[0] * scale
    return { tiles: [{ index: 0, x: (width - tileWidth) / 2, y: (height - scale) / 2, width: tileWidth, height: scale }], height: scale, score: 1 }
  }
  const target = width / height
  let best: Candidate | undefined
  const totals = aspects.reduce((sum, aspect) => sum + aspect, 0)
  const treeCache = new Map<string, Tree>()
  for (let split = 1; split < aspects.length; split++) {
    const leftWeight = aspects.slice(0, split).reduce((sum, ratio) => sum + ratio, 0)
    const rightWeight = totals - leftWeight
    for (const axis of ['row', 'column'] as const) {
      const leftTarget = axis === 'row' ? target * split / aspects.length * 1.1 : target * totals / leftWeight
      const rightTarget = axis === 'row' ? target * (aspects.length - split) / aspects.length * 1.1 : target * totals / rightWeight
      const leftTree = makeTree(aspects, 0, split, leftTarget, treeCache)
      const rightTree = makeTree(aspects, split, aspects.length, rightTarget, treeCache)
      const tree: Tree = { axis, left: leftTree, right: rightTree, aspect: axis === 'row' ? leftTree.aspect + rightTree.aspect : 1 / (1 / leftTree.aspect + 1 / rightTree.aspect) }
      const shape = axis === 'row'
        ? fitByHeight(tree, width, height, gap)
        : fitByWidth(tree, width, height, gap)
      if (!shape) continue
      const minSide = Math.min(...shape.tiles.map((tile) => Math.min(tile.width, tile.height)))
      const area = shape.tiles.reduce((sum, tile) => sum + tile.width * tile.height, 0)
      const score = area / (width * height) - Math.max(0, 140 - minSide) / 10_000
      if (!best || score > best.score) best = { tiles: shape.tiles, height: shape.height, score }
    }
  }
  return best
}

function fitByHeight(tree: Tree, width: number, height: number, gap: number): Shape | undefined {
  let low = 0, high = height
  for (let i = 0; i < FIT_ITERATIONS; i++) {
    const mid = (low + high) / 2
    if (layoutAtHeight(tree, mid, gap).width <= width) low = mid
    else high = mid
  }
  const shape = layoutAtHeight(tree, low, gap)
  return shape.width <= width + 0.1 && shape.height <= height + 0.1 ? shape : undefined
}

function fitByWidth(tree: Tree, width: number, height: number, gap: number): Shape | undefined {
  let low = 0, high = width
  for (let i = 0; i < FIT_ITERATIONS; i++) {
    const mid = (low + high) / 2
    if (layoutAtWidth(tree, mid, gap).height <= height) low = mid
    else high = mid
  }
  const shape = layoutAtWidth(tree, low, gap)
  return shape.width <= width + 0.1 && shape.height <= height + 0.1 ? shape : undefined
}

function buildJustified(aspects: number[], width: number, gap: number, minimumRowHeight: number): ReviewLayout {
  const count = aspects.length
  const cost = Array(count + 1).fill(Number.POSITIVE_INFINITY) as number[]
  const previous = Array(count + 1).fill(-1) as number[]
  cost[0] = 0
  for (let end = 1; end <= count; end++) {
    let sum = 0
    for (let start = end - 1; start >= 0 && end - start <= 12; start--) {
      sum += aspects[start]
      const rowHeight = (width - gap * (end - start - 1)) / sum
      if (rowHeight <= 0) continue
      const last = end === count
      const deviation = Math.log(Math.max(1, rowHeight) / minimumRowHeight)
      const shortfall = Math.max(0, minimumRowHeight - rowHeight) / minimumRowHeight
      const candidate = cost[start] + deviation * deviation * (last ? 0.12 : 0.4) + shortfall * shortfall * (last ? 0.1 : 5) + 0.035
      if (candidate < cost[end]) { cost[end] = candidate; previous[end] = start }
    }
  }
  const rows: Array<[number, number]> = []
  for (let end = count; end > 0;) {
    const start = previous[end] >= 0 ? previous[end] : end - 1
    rows.unshift([start, end]); end = start
  }
  const tiles: ReviewTile[] = []
  let y = 0
  rows.forEach(([start, end], rowIndex) => {
    const sum = aspects.slice(start, end).reduce((total, ratio) => total + ratio, 0)
    const naturalHeight = (width - gap * (end - start - 1)) / sum
    const scale = rowIndex === rows.length - 1 ? Math.min(naturalHeight, minimumRowHeight) : naturalHeight
    const rowWidth = sum * scale + gap * (end - start - 1)
    let x = Math.max(0, (width - rowWidth) / 2)
    for (let index = start; index < end; index++) {
      const tileWidth = aspects[index] * scale
      tiles.push({ index, x, y, width: tileWidth, height: scale })
      x += tileWidth + gap
    }
    y += scale + gap
  })
  return { mode: 'justified', tiles, height: Math.max(0, y - gap) }
}

export function buildReviewLayout(input: number[], width: number, height: number, gap = GAP, minimumPhotoSize = DEFAULT_REVIEW_MIN_SIZE): ReviewLayout {
  if (!input.length || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return { mode: 'mosaic', tiles: [], height: 0 }
  const aspects = normalize(input)
  if (aspects.length <= MOSAIC_LIMIT) {
    const candidate = buildSmallMosaic(aspects, width, height, gap)
    if (candidate && candidate.tiles.every((tile) => Math.min(tile.width, tile.height) >= minimumPhotoSize)) return { mode: 'mosaic', tiles: candidate.tiles, height }
  }
  return buildJustified(aspects, width, gap, minimumPhotoSize)
}
