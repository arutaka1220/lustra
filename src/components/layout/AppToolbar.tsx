import { PanelLeft, PanelLeftClose, Redo2, Settings2, Undo2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { canRedo, canUndo, useSessionStore, type WorkspaceScreen } from '../../store/session-store'

type AppToolbarProps = {
  photoCount: number
  completedCount: number
  screen: WorkspaceScreen
  inspectorOpen: boolean
  navigationLocked: boolean
  onHome: () => void
  onToggleInspector: () => void
  onOpenSettings: () => void
  onReview: () => void
}

export function AppToolbar({
  photoCount,
  completedCount,
  screen,
  inspectorOpen,
  navigationLocked,
  onHome,
  onToggleInspector,
  onOpenSettings,
  onReview,
}: AppToolbarProps) {
  const { t } = useTranslation()
  const undo = useSessionStore((state) => state.undo)
  const redo = useSessionStore((state) => state.redo)
  const undoAvailable = useSessionStore(canUndo)
  const redoAvailable = useSessionStore(canRedo)
  const showHistory = screen === 'edit' || (screen === 'welcome' && (undoAvailable || redoAvailable))

  return (
    <header className="app-header">
      <div className="app-toolbar__left">
        {screen === 'edit' && <button
          className="toolbar-icon-button"
          aria-label={t(inspectorOpen ? 'edit.hideInspector' : 'edit.showInspector')}
          title={t(inspectorOpen ? 'edit.hideInspector' : 'edit.showInspector')}
          onClick={onToggleInspector}
        >{inspectorOpen ? <PanelLeftClose size={18} /> : <PanelLeft size={18} />}</button>}
        <button className="brand" onClick={onHome} disabled={navigationLocked} aria-label={t('common.home')}>{t('app.name', { ns: 'common' })}</button>
      </div>

      {screen === 'edit' && <div className="app-toolbar__progress" aria-live="polite">
        <span className="app-toolbar__progress-value">{completedCount} / {photoCount}</span>
        <span>{t('edit.completed')}</span>
      </div>}

      <div className="app-toolbar__right">
        {showHistory && <>
          <button className="toolbar-icon-button" aria-label={t('edit.undo')} title={t('edit.undo')} onClick={undo} disabled={!undoAvailable || navigationLocked}><Undo2 size={17} /></button>
          <button className="toolbar-icon-button" aria-label={t('edit.redo')} title={t('edit.redo')} onClick={redo} disabled={!redoAvailable || navigationLocked}><Redo2 size={17} /></button>
        </>}
        {screen === 'edit' && <button className="button button--primary button--toolbar" onClick={onReview}>{t('edit.review')}</button>}
        <button className="toolbar-icon-button" aria-label={t('settings.title')} title={t('settings.title')} onClick={onOpenSettings} disabled={navigationLocked}><Settings2 size={18} /></button>
      </div>
    </header>
  )
}
