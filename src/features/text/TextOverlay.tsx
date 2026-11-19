import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent, PointerEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useSessionStore } from '../../store/session-store'
import type { FrameSettings, SessionPhoto } from '../../types/photo'
import { useMetadataCorrections } from './metadata-corrections-store'
import { useSelectedTextIds, useTextEditor } from './text-editor-store'
import { findTextGuides } from './text-guides'
import type { TextBounds } from './text-guides'
import {
  getCanvasFontFamily, getEffectiveMetadata, getTextAnchorPosition, getTextElements, resolveTemplate,
  TEXT_LINE_HEIGHT, TEXT_REFERENCE_SIZE, textColor,
} from './text-model'
import type { MetadataField, TextElement } from './text-model'
import './text.css'

type Size = { width: number; height: number }
type TextOverlayProps = {
  photo: SessionPhoto
  frame: FrameSettings
  interactive?: boolean
  canvasSize?: Size
  imageBounds?: TextBounds
  onRevealInspector?: () => void
}
type DragState = {
  pointerId: number
  originX: number
  originY: number
  scale: number
  bounds: TextBounds
  stationary: TextBounds[]
  moving: HTMLElement[]
  movingIds: string[]
  x: number
  y: number
  started: boolean
  missing?: MetadataField
}

function getBounds(element: Element, canvas: DOMRect): TextBounds {
  const { x, y, width, height } = element.getBoundingClientRect()
  return { x: x - canvas.x, y: y - canvas.y, width, height }
}

function joinBounds(rects: TextBounds[]): TextBounds {
  const x = Math.min(...rects.map((rect) => rect.x))
  const y = Math.min(...rects.map((rect) => rect.y))
  return {
    x, y,
    width: Math.max(...rects.map((rect) => rect.x + rect.width)) - x,
    height: Math.max(...rects.map((rect) => rect.y + rect.height)) - y,
  }
}

function layerStyle(element: TextElement, frame: FrameSettings, scale: number): CSSProperties {
  const [column, row] = getTextAnchorPosition(element.anchor)
  return {
    left: `calc(${column * 100}% + ${element.x * scale}px)`,
    top: `calc(${row * 100}% + ${element.y * scale}px)`,
    transform: `translate(${column * -100}%, ${row * -100}%) translate(var(--text-drag-x, 0px), var(--text-drag-y, 0px))`,
    color: textColor(element.color, frame.style),
    fontFamily: getCanvasFontFamily(element.fontFamily),
    fontWeight: element.weight,
    fontSize: element.size * scale,
    lineHeight: TEXT_LINE_HEIGHT,
    textAlign: column === 0 ? 'left' : column === 1 ? 'right' : 'center',
  }
}

export function TextOverlay({ photo, frame, interactive, canvasSize, imageBounds, onRevealInspector }: TextOverlayProps) {
  const { t } = useTranslation()
  const root = useRef<HTMLDivElement>(null)
  const verticalGuide = useRef<HTMLSpanElement>(null)
  const horizontalGuide = useRef<HTMLSpanElement>(null)
  const drag = useRef<DragState>(null)
  const [measuredSize, setMeasuredSize] = useState<Size | null>(null)
  const corrections = useMetadataCorrections((state) => state.corrections)
  const selected = useSelectedTextIds(interactive ? photo.id : '')
  const elements = getTextElements(frame)
  const metadata = getEffectiveMetadata(photo, corrections)
  const size = canvasSize ?? measuredSize
  const scale = size ? Math.min(size.width, size.height) / TEXT_REFERENCE_SIZE : 0

  useLayoutEffect(() => {
    if (canvasSize || !root.current) return
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return
      const { width, height } = entry.contentRect
      setMeasuredSize({ width, height })
    })
    observer.observe(root.current)
    return () => observer.disconnect()
  }, [canvasSize])

  useEffect(() => () => {
    if (drag.current) delete document.documentElement.dataset.lustraTextDrag
  }, [])

  const selectLayer = (id: string, add = false) => {
    const state = useTextEditor.getState()
    const current = state.selection?.photoId === photo.id ? state.selection.ids : []
    const next = add ? current.includes(id) ? current.filter((key) => key !== id) : [...current, id] : [id]
    state.select(photo.id, next)
    return next
  }

  const chooseLayer = (id: string, missing?: MetadataField) => {
    selectLayer(id)
    if (missing) revealMetadata(missing)
  }

  const revealMetadata = (field: MetadataField) => {
    onRevealInspector?.()
    useTextEditor.getState().focusMetadata({ photoId: photo.id, field })
  }

  const moveLayers = (ids: string[], dx: number, dy: number) => {
    if (!dx && !dy) return
    const state = useSessionStore.getState()
    // Use the photo scope for direct manipulation of an existing local layout.
    const localLayout = photo.overrides.textElements
    if (localLayout && state.editMode === 'all') state.setEditMode('this')
    state.updateFrame('textElements', elements.map((element) => ids.includes(element.id)
      ? { ...element, x: Math.round((element.x + dx) * 10) / 10, y: Math.round((element.y + dy) * 10) / 10 }
      : element))
  }

  const beginDrag = (event: PointerEvent<HTMLButtonElement>, element: TextElement, missing?: MetadataField) => {
    if (event.button !== 0 || !root.current || !scale) return
    event.stopPropagation()
    const retained = selected.includes(element.id) ? [...selected.filter((id) => id !== element.id), element.id] : [element.id]
    const ids = event.shiftKey ? selectLayer(element.id, true) : retained
    if (event.shiftKey && !ids.includes(element.id)) return
    const groups = new Set(elements.flatMap(({ id, groupId }) => ids.includes(id) && groupId ? [groupId] : []))
    const groupMembers = elements.filter(({ groupId }) => groupId && groups.has(groupId))
    const moveIds = new Set([...groupMembers.map(({ id }) => id).filter((id) => id !== element.id), ...ids])
    if (!event.shiftKey) useTextEditor.getState().select(photo.id, [...moveIds])
    const canvas = root.current.getBoundingClientRect()
    const moving: DragState['moving'] = []
    const stationary: TextBounds[] = []
    for (const node of root.current.querySelectorAll<HTMLElement>('[data-text-id]')) {
      const id = node.dataset.textId
      if (!id) continue
      if (moveIds.has(id)) moving.push(node)
      else stationary.push(getBounds(node, canvas))
    }
    if (!moving.length) return
    drag.current = {
      pointerId: event.pointerId,
      originX: event.clientX,
      originY: event.clientY,
      scale,
      bounds: joinBounds(moving.map((node) => getBounds(node, canvas))),
      stationary,
      moving,
      movingIds: [...moveIds],
      x: 0,
      y: 0,
      started: false,
      missing,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const updateDrag = (event: PointerEvent<HTMLButtonElement>) => {
    const current = drag.current
    if (!current || current.pointerId !== event.pointerId || !size) return
    const x = event.clientX - current.originX
    const y = event.clientY - current.originY
    if (!current.started && Math.hypot(x, y) < 3) return
    current.started = true
    document.documentElement.dataset.lustraTextDrag = 'true'
    const shifted = { ...current.bounds, x: current.bounds.x + x, y: current.bounds.y + y }
    const snap = useTextEditor.getState().guidesEnabled
      ? findTextGuides(shifted, current.stationary, { ...size, x: 0, y: 0 }, imageBounds)
      : null
    const dx = x + (snap?.horizontal?.shift ?? 0)
    const dy = y + (snap?.vertical?.shift ?? 0)
    current.x = dx
    current.y = dy

    for (const node of current.moving) {
      node.style.setProperty('--text-drag-x', `${dx}px`)
      node.style.setProperty('--text-drag-y', `${dy}px`)
    }
    if (verticalGuide.current) {
      verticalGuide.current.hidden = !snap?.horizontal
      if (snap?.horizontal) verticalGuide.current.style.left = `${snap.horizontal.guide}px`
    }
    if (horizontalGuide.current) {
      horizontalGuide.current.hidden = !snap?.vertical
      if (snap?.vertical) horizontalGuide.current.style.top = `${snap.vertical.guide}px`
    }
  }

  const endDrag = (event: PointerEvent<HTMLButtonElement>, commit: boolean) => {
    const current = drag.current
    if (!current || current.pointerId !== event.pointerId) return
    drag.current = null
    delete document.documentElement.dataset.lustraTextDrag
    for (const node of current.moving) {
      node.style.removeProperty('--text-drag-x')
      node.style.removeProperty('--text-drag-y')
    }
    if (horizontalGuide.current) horizontalGuide.current.hidden = true
    if (verticalGuide.current) verticalGuide.current.hidden = true
    if (!commit) return
    if (current.started) moveLayers(current.movingIds, current.x / current.scale, current.y / current.scale)
    else if (current.missing) revealMetadata(current.missing)
  }

  const keyboardMove = (event: KeyboardEvent<HTMLButtonElement>, element: TextElement) => {
    const directions: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }
    const direction = directions[event.key]
    if (!direction) return
    event.preventDefault()
    event.stopPropagation()
    const amount = event.shiftKey ? 10 : 1
    const ids = element.groupId
      ? elements.filter((candidate) => candidate.groupId === element.groupId).map(({ id }) => id)
      : [element.id]
    moveLayers(ids, direction[0] * amount, direction[1] * amount)
  }

  return (
    <div ref={root} className="text-overlay" aria-hidden={interactive ? undefined : true}>
      {scale > 0 && elements.map((element) => {
        if (!element.visible) return null
        const { text, missing } = resolveTemplate(element.template, metadata)
        const provisional = missing.length > 0
        if (!interactive && (provisional || !text.trim())) return null
        const style = layerStyle(element, frame, scale)
        if (!interactive) return <span className="canvas-text" key={element.id} style={style}>{text}</span>
        const message = provisional
          ? photo.metadataState === 'loading' && !photo.metadataOverrides
            ? t('text.pending')
            : t('text.missing', { fields: missing.map((field) => t(`text.metadata.${field}`)).join(', ') })
          : text || t('text.empty')
        return (
          <button
            className={`canvas-text canvas-text--interactive${provisional || !text.trim() ? ' canvas-text--placeholder' : ''}`}
            data-text-id={element.id}
            key={element.id}
            type="button"
            style={style}
            title={message}
            aria-pressed={selected.includes(element.id)}
            onPointerDown={(event) => beginDrag(event, element, missing[0])}
            onPointerMove={updateDrag}
            onPointerUp={(event) => endDrag(event, true)}
            onPointerCancel={(event) => endDrag(event, false)}
            onLostPointerCapture={(event) => endDrag(event, false)}
            onKeyDown={(event) => keyboardMove(event, element)}
            onClick={(event) => {
              if (event.detail === 0) chooseLayer(element.id, missing[0])
            }}
          >{message}</button>
        )
      })}
      {interactive && <>
        <span className="text-guide text-guide--vertical" ref={verticalGuide} hidden />
        <span className="text-guide text-guide--horizontal" ref={horizontalGuide} hidden />
      </>}
    </div>
  )
}
