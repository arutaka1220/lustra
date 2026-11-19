import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import '../../styles/photo-grid.css'

type PhotoGridProps<T> = {
  items: T[]
  className: string
  minColumnWidth: number
  gap: number
  padding: number
  itemHeight: (columnWidth: number) => number
  renderItem: (item: T, index: number) => ReactNode
  style?: CSSProperties
}

export function PhotoGrid<T>({ items, className, minColumnWidth, gap, padding, itemHeight, renderItem, style }: PhotoGridProps<T>) {
  const viewport = useRef<HTMLDivElement>(null)
  const [metrics, setMetrics] = useState({ width: 0, height: 0, scrollTop: 0 })

  const resizeObserver = useMemo(() => new ResizeObserver(([entry]) => {
    if (!entry) return
    const { width, height } = entry.contentRect
    setMetrics((current) => current.width === width && current.height === height ? current : { ...current, width, height })
  }), [])
  useEffect(() => () => resizeObserver.disconnect(), [resizeObserver])

  const setViewport = useCallback((element: HTMLDivElement | null) => {
    resizeObserver.disconnect()
    viewport.current = element
    if (element) resizeObserver.observe(element)
  }, [resizeObserver])

  const contentWidth = Math.max(0, metrics.width)
  const columns = Math.max(1, Math.floor((contentWidth + gap) / (minColumnWidth + gap)))
  const columnWidth = Math.max(1, (contentWidth - gap * (columns - 1)) / columns)
  const rowHeight = itemHeight(columnWidth)
  const rowPitch = rowHeight + gap
  const rowCount = Math.ceil(items.length / columns)
  const firstRow = Math.max(0, Math.floor(metrics.scrollTop / rowPitch) - 2)
  const lastRow = Math.min(rowCount, Math.ceil((metrics.scrollTop + metrics.height) / rowPitch) + 2)
  const rows = []

  for (let row = firstRow; row < lastRow; row += 1) {
    const start = row * columns
    const end = Math.min(items.length, start + columns)
    rows.push(
      <div className="photo-virtual-grid__row" key={row} style={{
        position: 'absolute',
        insetInline: 0,
        top: row * rowPitch,
        height: rowHeight,
        display: 'grid',
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        gap,
      }}>
        {items.slice(start, end).map((item, offset) => <div className="photo-virtual-grid__cell" key={start + offset}>{renderItem(item, start + offset)}</div>)}
      </div>,
    )
  }

  return <div
    ref={setViewport}
    className={`photo-virtual-grid ${className}`}
    style={{ display: 'block', overflow: 'auto', padding, ...style }}
    onScroll={(event) => setMetrics((current) => ({ ...current, scrollTop: event.currentTarget.scrollTop }))}
  >
    <div className="photo-virtual-grid__content" style={{ position: 'relative', width: '100%', height: Math.max(0, rowCount * rowPitch - (rowCount ? gap : 0)) }}>
      {rows}
    </div>
  </div>
}
