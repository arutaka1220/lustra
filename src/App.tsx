import { useEffect, useState } from 'react'
import { Aperture, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { PhotoMetadataNoticeDialog } from './components/layout/PhotoMetadataNoticeDialog'
import { PreferencesDialog } from './components/layout/PreferencesDialog'
import { WelcomeScreen } from './components/layout/WelcomeScreen'
import { AppToolbar } from './components/layout/AppToolbar'
import { EditorScreen } from './features/editor/EditorScreen'
import { ImportScreen } from './features/import/ImportScreen'
import { ReviewScreen } from './features/review/ReviewScreen'
import { useEditorShortcuts } from './hooks/useEditorShortcuts'
import { useInspectorLayout } from './hooks/useInspectorLayout'
import { usePhotoImport } from './features/import/usePhotoImport'
import { useSessionStore } from './store/session-store'
import { flushSessionPersistence, readAppPreference, useSessionPersistence } from './store/session-persistence'
import { useMetadataCorrections } from './features/text/metadata-corrections-store'
import { ExportScreen } from './features/export/ExportScreen'
import { useUpdateStore } from './features/updates/update-store'
import './styles/workflow.css'

export function App() {
  const { t, i18n } = useTranslation()
  const screen = useSessionStore((state) => state.screen)
  const setScreen = useSessionStore((state) => state.setScreen)
  const photos = useSessionStore((state) => state.photos)
  const commonFrame = useSessionStore((state) => state.commonFrame)
  const finishSession = useSessionStore((state) => state.finishSession)
  const endFrameEdit = useSessionStore((state) => state.endFrameEdit)
  const suspendCurrentSession = useSessionStore((state) => state.suspendCurrentSession)
  const resumeSuspendedSession = useSessionStore((state) => state.resumeSuspendedSession)
  const clearImport = useSessionStore((state) => state.clearImport)
  const settingsOpen = useSessionStore((state) => state.settingsOpen)
  const toggleSettings = useSessionStore((state) => state.toggleSettings)
  const updater = useUpdateStore()
  const [dismissedUpdateNotice, setDismissedUpdateNotice] = useState('')
  const [focusUpdatesRevision, setFocusUpdatesRevision] = useState(0)
  const completedCount = photos.filter((photo) => photo.completed).length
  const inspector = useInspectorLayout()
  const persistence = useSessionPersistence()
  const [exportBusy, setExportBusy] = useState(false)
  const [suspending, setSuspending] = useState(false)
  const [suspendError, setSuspendError] = useState<string | null>(null)
  const photoImport = usePhotoImport(persistence.ready, screen !== 'export')
  const loadMetadataCorrections = useMetadataCorrections((state) => state.load)
  const updateNoticeKey = `${updater.status}:${updater.channel}:${updater.update?.version ?? ''}`
  const showUpdateNotice = ['available', 'readyToRestart', 'failed'].includes(updater.status)
    && dismissedUpdateNotice !== updateNoticeKey

  function openUpdateSettings() {
    setFocusUpdatesRevision((revision) => revision + 1)
    if (!settingsOpen) toggleSettings()
  }

  const goHome = async () => {
    if (screen === 'import' && !photos.length) {
      clearImport()
      setScreen('welcome')
      return
    }
    if (!photos.length) {
      setScreen('welcome')
      return
    }
    setSuspending(true)
    setSuspendError(null)
    try {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
      endFrameEdit()
      const id = suspendCurrentSession()
      if (!id) {
        setScreen('welcome')
        return
      }
      await flushSessionPersistence()
    } catch (error) {
      const id = useSessionStore.getState().suspendedSessions[0]?.id
      if (id) resumeSuspendedSession(id)
      setSuspendError(error instanceof Error ? error.message : String(error))
    } finally {
      setSuspending(false)
    }
  }

  useEditorShortcuts(persistence.ready && !settingsOpen ? screen : 'welcome')
  useEffect(() => { void loadMetadataCorrections() }, [loadMetadataCorrections])
  useEffect(() => {
    let disposed = false
    void readAppPreference<string>('ui.language').then((language) => {
      if (!disposed && (language === 'en' || language === 'ja')) void i18n.changeLanguage(language)
    }).catch((error) => console.error('Could not restore the display language', error))
    return () => { disposed = true }
  }, [i18n])

  return (
    <div className="app-shell" onDrop={photoImport.handleDrop} onDragOver={(event) => {
      if (event.dataTransfer.types.includes('Files')) event.preventDefault()
    }}>
      <input
        ref={photoImport.fileInputRef}
        className="visually-hidden"
        type="file"
        multiple
        accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
        onChange={(event) => {
          photoImport.handleBrowserFiles(event.currentTarget.files)
          event.currentTarget.value = ''
        }}
      />
      <input
        ref={photoImport.folderInputRef}
        className="visually-hidden"
        type="file"
        multiple
        accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
        onChange={(event) => {
          photoImport.handleBrowserFiles(event.currentTarget.files, true)
          event.currentTarget.value = ''
        }}
        {...{ webkitdirectory: '', directory: '' }}
      />

      <AppToolbar
        photoCount={photos.length}
        completedCount={completedCount}
        screen={screen}
        inspectorOpen={inspector.inspectorOpen}
        navigationLocked={!persistence.ready || exportBusy || suspending}
        onHome={() => { void goHome() }}
        onToggleInspector={inspector.toggleInspector}
        onOpenSettings={toggleSettings}
        onReview={() => setScreen('review')}
      />

      {suspendError && <div className="persistence-notice" role="alert">
        <div><strong>{t('session.saveError')}</strong><small>{suspendError}</small></div>
        <button className="button button--secondary button--small" onClick={() => { void goHome() }}>{t('common.retry')}</button>
      </div>}

      {persistence.error && <div className="persistence-notice" role="alert">
        <div><strong>{t(persistence.protectedArchive || !persistence.ready ? 'session.loadError' : 'session.saveError')}</strong><small>{persistence.error}</small>
          {persistence.protectedArchive && <small>{t('session.recoveryNoOverwrite')}</small>}
        </div>
        <button className="button button--secondary button--small" onClick={persistence.retry}>{t('common.retry')}</button>
        {!persistence.ready && <button className="button button--secondary button--small" onClick={persistence.goHome}>{t('common.home')}</button>}
      </div>}
      {!persistence.ready && !persistence.error && <main className="session-loading" role="status">{t('session.loading')}</main>}
      {persistence.ready && screen === 'welcome' && <WelcomeScreen onImportPhotos={photoImport.openFiles} onImportFolder={photoImport.openFolder} />}
      {persistence.ready && screen === 'import' && <ImportScreen
        onAddFiles={photoImport.openFiles}
        onAddFolder={photoImport.openFolder}
        onDropFiles={photoImport.handleDrop}
        dragging={photoImport.isNativeDragging}
      />}
      {persistence.ready && screen === 'edit' && <EditorScreen
        inspectorOpen={inspector.inspectorOpen}
        inspectorWidth={inspector.inspectorWidth}
        onResizeInspector={inspector.startResize}
        onResetInspectorWidth={inspector.resetInspectorWidth}
        onResizeInspectorBy={inspector.resizeBy}
        onRevealInspector={inspector.revealInspector}
        onAddPhotos={photoImport.openFiles}
      />}
      {persistence.ready && screen === 'review' && <ReviewScreen />}
      {persistence.ready && screen === 'export' && <ExportScreen
        photos={photos}
        commonFrame={commonFrame}
        onBackToReview={() => setScreen('review')}
        onBackToEditing={() => setScreen('edit')}
        onFinish={finishSession}
        onBusyChange={setExportBusy}
      />}

      {photoImport.isNativeDragging && screen !== 'import' && screen !== 'export' && <div className="global-drop-indicator"><span><Aperture size={20} /> {t('import.dropOverlay')}</span></div>}

      <PreferencesDialog
        open={settingsOpen}
        exportBusy={exportBusy}
        persistenceReady={persistence.ready && !persistence.error}
        focusUpdatesRevision={focusUpdatesRevision}
        onOpenChange={(open) => { if (!open && settingsOpen) toggleSettings() }}
      />
      {showUpdateNotice && <aside className="update-notice" role={updater.status === 'failed' ? 'alert' : 'status'}>
        <div><strong>{t('updates.noticeTitle')}</strong><span>{updater.status === 'failed'
          ? t('updates.errorDetail', { error: updater.error ?? t('updates.error') })
          : updater.status === 'readyToRestart'
            ? t('updates.status.readyToRestart')
            : t('updates.noticeAvailable', { version: updater.update?.version ?? '' })}</span></div>
        <button className="button button--secondary button--small" onClick={openUpdateSettings}>{t('updates.openSettings')}</button>
        <button className="icon-button" aria-label={t('updates.dismiss')} onClick={() => setDismissedUpdateNotice(updateNoticeKey)}><X size={15} /></button>
      </aside>}
      <PhotoMetadataNoticeDialog open={photoImport.formatNoticeOpen} onDismiss={photoImport.dismissFormatNotice} />
    </div>
  )
}
