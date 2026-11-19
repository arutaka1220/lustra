import * as Dialog from '@radix-ui/react-dialog'
import { HardDrive, Info, Languages, ScanLine, Upload, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getVersion } from '@tauri-apps/api/app'
import { isTauri } from '@tauri-apps/api/core'
import { ExportPreferencesPanel } from '../../features/export/ExportPreferencesPanel'
import { MetadataCorrections } from '../../features/text/MetadataCorrections'
import { SelectField } from '../ui/SelectField'
import { clearThumbnailCache, getThumbnailCacheSize, writeAppPreference } from '../../store/session-persistence'
import { useSessionStore } from '../../store/session-store'

type PreferencesDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const sections = [
  { id: 'general', label: 'settings.generalTitle', icon: Languages },
  { id: 'metadata', label: 'settings.metadataTitle', icon: ScanLine },
  { id: 'export', label: 'settings.exportTitle', icon: Upload },
  { id: 'performance', label: 'settings.performanceTitle', icon: HardDrive },
  { id: 'about', label: 'settings.aboutTitle', icon: Info },
] as const

const possibleUndoLimits = [25, 50, 100, 200]

export function PreferencesDialog({ open, onOpenChange }: PreferencesDialogProps) {
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
              {section === 'about' && <div className="preference-row"><strong>Lustra</strong>{version && <span>{version}</span>}</div>}
              {error && <p className="workflow-error" role="alert">{t(error)}</p>}
            </section>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
