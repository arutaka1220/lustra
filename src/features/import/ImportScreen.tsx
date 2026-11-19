import { Check, FolderOpen, ImagePlus, Plus, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useSessionStore } from '../../store/session-store'
import { PhotoGrid } from './PhotoGrid'
import { PhotoThumbnailCanvas } from './PhotoThumbnailCanvas'

const importDragType = 'application/x-lustra-import-photo'

type ImportScreenProps = {
  onAddFiles: () => void
  onAddFolder: () => void
  onDropFiles: (event: React.DragEvent<HTMLElement>) => void
  dragging: boolean
}

export function ImportScreen({ onAddFiles, onAddFolder, onDropFiles, dragging }: ImportScreenProps) {
  const { t } = useTranslation()
  const candidates = useSessionStore((state) => state.candidates)
  const photos = useSessionStore((state) => state.photos)
  const selectAll = useSessionStore((state) => state.selectAllCandidates)
  const removeCandidate = useSessionStore((state) => state.removeCandidate)
  const reorder = useSessionStore((state) => state.reorderCandidates)
  const setCandidates = useSessionStore((state) => state.setCandidates)
  const importSelected = useSessionStore((state) => state.importSelected)
  const clearImport = useSessionStore((state) => state.clearImport)
  const setScreen = useSessionStore((state) => state.setScreen)
  const selectedCount = candidates.filter((candidate) => candidate.selected).length

  return (
    <main className="import-view" onDrop={onDropFiles} onDragOver={(event) => {
      if (event.dataTransfer.types.includes('Files')) event.preventDefault()
    }}>
      <div className="import-heading">
        <div>
          <h1>{t('import.title')}</h1>
          <p>{t('import.body')}</p>
        </div>
        <button className="button button--quiet" onClick={() => { clearImport(); setScreen(photos.length ? 'edit' : 'welcome') }}>
          <X size={16} /> {t('common.cancel')}
        </button>
      </div>

      {candidates.length === 0 ? (
        <div className={`import-dropzone ${dragging ? 'is-dragging' : ''}`}>
          <div className="import-dropzone__icon"><ImagePlus size={24} /></div>
          <strong>{t('import.empty')}</strong>
          <span>{t('import.formats')}</span>
          <div className="import-dropzone__actions">
            <button className="button button--primary" onClick={onAddFiles}><Plus size={16} /> {t('import.addFiles')}</button>
            <button className="button button--secondary" onClick={onAddFolder}><FolderOpen size={16} /> {t('import.addFolder')}</button>
          </div>
          {dragging && <div className="dropzone-overlay">{t('import.dropOverlay')}</div>}
        </div>
      ) : (
        <section className="candidate-sheet">
          <div className="candidate-toolbar">
            <div className="candidate-selection"><span className="selection-indicator"><Check size={12} /></span><strong>{t('import.selected', { count: selectedCount, total: candidates.length })}</strong></div>
            <div className="candidate-actions">
              <button className="text-button" onClick={() => selectAll(true)}>{t('import.selectAll')}</button>
              <span className="toolbar-divider" />
              <button className="text-button" onClick={() => selectAll(false)}>{t('import.deselectAll')}</button>
              <button className="button button--secondary button--small" onClick={onAddFiles}><Plus size={14} /> {t('import.addFiles')}</button>
              <button className="button button--secondary button--small" onClick={onAddFolder}><FolderOpen size={14} /> {t('import.addFolder')}</button>
            </div>
          </div>
          <PhotoGrid
            className={`candidate-grid ${dragging ? 'is-dragging' : ''}`}
            items={candidates}
            minColumnWidth={156}
            gap={14}
            padding={16}
            itemHeight={(width) => width * 0.8 + 42}
            renderItem={(candidate, index) => (
              <article className={`candidate-card ${candidate.selected ? 'is-selected' : ''}`} key={candidate.id}
                onDragOver={(event) => {
                  if (event.dataTransfer.types.includes(importDragType)) {
                    event.preventDefault()
                    event.dataTransfer.dropEffect = 'move'
                  }
                }}
                onDrop={(event) => {
                  const from = event.dataTransfer.getData(importDragType)
                  if (!from) return
                  event.preventDefault()
                  event.stopPropagation()
                  reorder(from, candidate.id)
                }}>
                <button className="candidate-toggle" draggable aria-pressed={candidate.selected}
                  onClick={() => setCandidates((items) => items.map((item) => item.id === candidate.id ? { ...item, selected: !item.selected } : item))}
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = 'move'
                    event.dataTransfer.setData(importDragType, candidate.id)
                  }}
                  onKeyDown={(event) => {
                    if (!event.altKey || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return
                    const other = candidates[index + (event.key === 'ArrowRight' ? 1 : -1)]
                    if (!other) return
                    event.preventDefault()
                    reorder(candidate.id, other.id)
                  }}>
                  <span className="candidate-image-wrap">
                    <PhotoThumbnailCanvas url={candidate.source.url} />
                    <span className="candidate-check">{candidate.selected && <Check size={13} strokeWidth={3} />}</span>
                  </span>
                  <span className="candidate-info">
                    <strong title={candidate.name}>{candidate.name}</strong>
                    {candidate.metadataState === 'loading' && <span>{t('import.reading')}</span>}
                  </span>
                </button>
                <button className="candidate-remove" aria-label={t('import.remove', { name: candidate.name })} onClick={() => removeCandidate(candidate.id)}><X size={13} /></button>
              </article>
            )}
          />
          {dragging && <div className="candidate-drop-hint">{t('import.dropOverlay')}</div>}
          <footer className="candidate-footer">
            <button className="button button--primary button--large" onClick={importSelected} disabled={!selectedCount}>{t('import.confirmCount', { count: selectedCount })}</button>
          </footer>
        </section>
      )}
    </main>
  )
}
