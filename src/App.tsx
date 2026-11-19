import { useEffect, useState } from 'react'
import { Aperture } from 'lucide-react'
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
import { useSystemTheme } from './hooks/useSystemTheme'
import { usePhotoImport } from './features/import/usePhotoImport'
import { useSessionStore } from './store/session-store'
import { readAppPreference, useSessionPersistence } from './store/session-persistence'
import { useMetadataCorrections } from './features/text/metadata-corrections-store'
import { ExportScreen } from './features/export/ExportScreen'
import './styles/workflow.css'

export function App() {
  const { t, i18n } = useTranslation()
  const screen = useSessionStore((state) => state.screen)
  const setScreen = useSessionStore((state) => state.setScreen)
  const photos = useSessionStore((state) => state.photos)
  const commonFrame = useSessionStore((state) => state.commonFrame)
  const finishSession = useSessionStore((state) => state.finishSession)
  const clearImport = useSessionStore((state) => state.clearImport)
  const settingsOpen = useSessionStore((state) => state.settingsOpen)
  const toggleSettings = useSessionStore((state) => state.toggleSettings)
  const completedCount = photos.filter((photo) => photo.completed).length
  const theme = useSystemTheme()
  const inspector = useInspectorLayout()
  const persistence = useSessionPersistence()
  const [exportBusy, setExportBusy] = useState(false)
  const photoImport = usePhotoImport(persistence.ready, screen !== 'export')
  const loadMetadataCorrections = useMetadataCorrections((state) => state.load)

  useEditorShortcuts(persistence.ready && !settingsOpen ? screen : 'welcome')
  useEffect(() => { document.documentElement.dataset.theme = theme }, [theme])
  useEffect(() => { void loadMetadataCorrections() }, [loadMetadataCorrections])
  useEffect(() => {
    let disposed = false
    void readAppPreference<string>('ui.language').then((language) => {
      if (!disposed && (language === 'en' || language === 'ja')) void i18n.changeLanguage(language)
    }).catch((error) => console.error('Could not restore the display language', error))
    return () => { disposed = true }
  }, [i18n])

  return (
    <div className="app-shell" data-theme={theme} onDrop={photoImport.handleDrop} onDragOver={(event) => {
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
        navigationLocked={!persistence.ready || exportBusy}
        onHome={() => {
          if (screen === 'import') clearImport()
          setScreen('welcome')
        }}
        onToggleInspector={inspector.toggleInspector}
        onOpenSettings={toggleSettings}
        onReview={() => setScreen('review')}
      />

      {persistence.error && <div className="persistence-notice" role="alert">
        <div><strong>{t(persistence.ready ? 'session.saveError' : 'session.loadError')}</strong><small>{persistence.error}</small></div>
        <button className="button button--secondary button--small" onClick={persistence.retry}>{t('common.retry')}</button>
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
        onOpenChange={(open) => { if (!open && settingsOpen) toggleSettings() }}
      />
      <PhotoMetadataNoticeDialog open={photoImport.formatNoticeOpen} onDismiss={photoImport.dismissFormatNotice} />
    </div>
  )
}
