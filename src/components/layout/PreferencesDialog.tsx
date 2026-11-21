import * as Dialog from '@radix-ui/react-dialog'
import { HardDrive, Info, Languages, RefreshCw, ScanLine, Upload, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getVersion } from '@tauri-apps/api/app'
import { isTauri } from '@tauri-apps/api/core'
import { ExportPreferencesPanel } from '../../features/export/ExportPreferencesPanel'
import { MetadataCorrections } from '../../features/text/MetadataCorrections'
import { SelectField } from '../ui/SelectField'
import { clearThumbnailCache, getThumbnailCacheSize, writeAppPreference } from '../../store/session-persistence'
import { useSessionStore } from '../../store/session-store'
import { useUpdateStore } from '../../features/updates/update-store'
import type { UpdateChannel } from '../../features/updates/update-store'
import { canInstallUpdate } from '../../features/updates/update-policy'

type PreferencesDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  exportBusy: boolean
  persistenceReady: boolean
  focusUpdatesRevision: number
}

const sections = [
  { id: 'general', label: 'settings.generalTitle', icon: Languages },
  { id: 'metadata', label: 'settings.metadataTitle', icon: ScanLine },
  { id: 'export', label: 'settings.exportTitle', icon: Upload },
  { id: 'performance', label: 'settings.performanceTitle', icon: HardDrive },
  { id: 'updates', label: 'updates.title', icon: RefreshCw },
  { id: 'about', label: 'settings.aboutTitle', icon: Info },
] as const

const possibleUndoLimits = [25, 50, 100, 200]

export function PreferencesDialog({ open, onOpenChange, exportBusy, persistenceReady, focusUpdatesRevision }: PreferencesDialogProps) {
  const { t, i18n } = useTranslation()
  const [section, setSection] = useState<(typeof sections)[number]['id']>('general')
  const [cacheSize, setCacheSize] = useState<number | null>(null)
  const [cacheBusy, setCacheBusy] = useState(false)
  const [version, setVersion] = useState('')
  const [error, setError] = useState<string | null>(null)
  const recentLimit = useSessionStore((state) => state.recentLimit)
  const undoLimit = useSessionStore((state) => state.undoLimit)
  const setRecentLimit = useSessionStore((state) => state.setRecentLimit)
  const setUndoLimit = useSessionStore((state) => state.setUndoLimit)
  const language = i18n.resolvedLanguage?.startsWith('ja') ? 'ja' : 'en'
  const updater = useUpdateStore()

  useEffect(() => {
    if (open && section === 'performance') {
      let disposed = false
      void getThumbnailCacheSize().then((size) => {
        if (!disposed) setCacheSize(size)
      }).catch(() => {
        if (!disposed) setError('settings.storageError')
      })
      return () => { disposed = true }
    }
    if (open && section === 'about' && isTauri()) {
      void getVersion().then(setVersion).catch(() => undefined)
    }
  }, [open, section])

  useEffect(() => {
    void updater.initialize()
  }, [updater.initialize])

  useEffect(() => {
    if (focusUpdatesRevision > 0) setSection('updates')
  }, [focusUpdatesRevision])

  async function updateLanguage(next: string) {
    setError(null)
    try {
      await writeAppPreference('ui.language', next)
      localStorage.setItem('lustra.language', next)
      await i18n.changeLanguage(next)
    } catch {
      setError('settings.preferenceError')
    }
  }

  async function clearCache() {
    setCacheBusy(true)
    setError(null)
    try {
      await clearThumbnailCache()
      setCacheSize(await getThumbnailCacheSize())
    } catch {
      setError('settings.storageError')
    } finally {
      setCacheBusy(false)
    }
  }

  const activeSection = sections.find((item) => item.id === section)!
  const cacheUsage = cacheSize === null ? '—' : new Intl.NumberFormat(language, {
    style: 'unit', unit: cacheSize >= 1048576 ? 'megabyte' : 'kilobyte', maximumFractionDigits: 1,
  }).format(cacheSize / (cacheSize >= 1048576 ? 1048576 : 1024))

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="settings-dialog preferences-dialog">
          <div className="preferences-heading">
            <Dialog.Title className="dialog-title">{t('settings.title')}</Dialog.Title>
            <Dialog.Close asChild><button className="icon-button" aria-label={t('common.close')}><X size={16} /></button></Dialog.Close>
          </div>
          <Dialog.Description className="visually-hidden">{t('settings.description')}</Dialog.Description>
          <div className="preferences-body">
            <nav aria-label={t('settings.title')}>
              {sections.map(({ id, label, icon: Icon }) => <button type="button" key={id} aria-pressed={section === id} onClick={() => { setSection(id); setError(null) }}><Icon size={16} /> {t(label)}</button>)}
            </nav>
            <section aria-label={t(activeSection.label)} className="preferences-content">
              {section === 'general' && <label className="preference-row">
                <div><strong>{t('settings.language')}</strong><span>{t('settings.languageBody')}</span></div>
                <SelectField value={language} onValueChange={(value) => void updateLanguage(value)} options={[
                  { value: 'en', label: 'English' }, { value: 'ja', label: '日本語' },
                ]} />
              </label>}
              {section === 'metadata' && <MetadataCorrections />}
              {section === 'export' && <ExportPreferencesPanel />}
              {section === 'performance' && <>
                <label className="preference-row"><strong>{t('settings.recentLimit')}</strong>
                  <SelectField value={String(recentLimit)} onValueChange={(value) => setRecentLimit(Number(value))} options={
                    Array.from({ length: 30 }, (_, index) => index + 1).map((limit) => ({ value: String(limit), label: String(limit) }))
                  } />
                </label>
                <label className="preference-row"><strong>{t('settings.undoLimit')}</strong>
                  <SelectField value={String(undoLimit)} onValueChange={(value) => setUndoLimit(Number(value))} options={
                    possibleUndoLimits.map((limit) => ({ value: String(limit), label: String(limit) }))
                  } />
                </label>
                <div className="preference-row">
                  <div><strong>{t('settings.cacheTitle')}</strong><span>{t('settings.cacheSize', { size: cacheUsage })}</span></div>
                  <button className="button button--secondary" onClick={() => void clearCache()} disabled={cacheBusy || !cacheSize}>{t('settings.clearCache')}</button>
                </div>
              </>}
              {section === 'updates' && <>
                <label className="preference-row">
                  <div><strong>{t('updates.channel')}</strong><span>{t('updates.channelBody')}</span></div>
                  <SelectField value={updater.channel} onValueChange={(value) => void updater.setChannel(value as UpdateChannel)} options={[
                    { value: 'stable', label: t('updates.stable') }, { value: 'beta', label: t('updates.beta') },
                  ]} />
                </label>
                {updater.channel === 'beta' && <p className="preferences-note">{t('updates.betaWarning')}</p>}
                <label className="preference-row">
                  <div><strong>{t('updates.automatic')}</strong><span>{t('updates.automaticBody')}</span></div>
                  <input type="checkbox" checked={updater.automatic} onChange={(event) => void updater.setAutomatic(event.currentTarget.checked)} />
                </label>
                <div className="preference-row"><div><strong>{t('updates.currentVersion')}</strong><span>{updater.version || '—'}</span></div></div>
                <div className="preference-row"><div><strong>{t('updates.currentChannel')}</strong><span>{t(`updates.${updater.channel}`)}</span></div></div>
                <div className="preference-row">
                  <div><strong>{t('updates.lastChecked')}</strong><span>{updater.lastChecked ? new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(updater.lastChecked)) : t('updates.neverChecked')}</span></div>
                  <button className="button button--secondary" disabled={updater.status === 'checking' || updater.status === 'downloading'} onClick={() => void updater.check(true)}>{t('updates.checkNow')}</button>
                </div>
                {updater.status !== 'idle' && <p className="preferences-note" role="status">{t(`updates.status.${updater.status}`)}</p>}
                {updater.update && <div className="preference-row">
                  <div><strong>{t('updates.availableVersion', { version: updater.update.version })}</strong>{updater.update.notes && <span>{updater.update.notes}</span>}</div>
                  {updater.status === 'available' && <button className="button button--secondary" onClick={() => void updater.download()}>{updater.automatic ? t('updates.downloadNow') : t('updates.downloadManual')}</button>}
                  {updater.status === 'readyToRestart' && <button className="button button--primary" disabled={!canInstallUpdate(updater.status, persistenceReady, exportBusy)} onClick={() => void updater.install(!canInstallUpdate(updater.status, persistenceReady, exportBusy))}>{t('updates.installRestart')}</button>}
                </div>}
                {updater.status === 'downloading' && <div className="preference-row">
                  <div><strong>{t('updates.downloadProgress')}</strong><span>{updater.contentLength ? `${Math.min(100, Math.round(updater.downloaded / updater.contentLength * 100))}%` : t('updates.downloading')}</span></div>
                  {updater.contentLength && <progress max={updater.contentLength} value={Math.min(updater.downloaded, updater.contentLength)} />}
                </div>}
                {updater.status === 'failed' && <div className="preference-row"><span>{updater.error ? t('updates.errorDetail', { error: updater.error }) : t('updates.error')}</span><button className="button button--secondary" onClick={() => void updater.check(true)}>{t('common.retry')}</button></div>}
                {exportBusy && <p className="preferences-note">{t('updates.exportBusy')}</p>}
              </>}
              {section === 'about' && <div className="preference-row"><strong>Lustra</strong>{version && <span>{version}</span>}</div>}
              {error && <p className="workflow-error" role="alert">{t(error)}</p>}
            </section>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
