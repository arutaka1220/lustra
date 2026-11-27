import { isTauri } from '@tauri-apps/api/core'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { ExportSettingsFields } from './ExportSettingsFields'
import { useExportPreferences } from './useExportPreferences'
import '../../styles/export.css'

type PreferenceValues = ReturnType<typeof useExportPreferences>

export function ExportPreferencesContent({ values, language }: { values: PreferenceValues; language: string }) {
  const { t } = useTranslation()
  if (!isTauri()) return <p className="export-message">{t('export.browserOnly')}</p>
  if (values.status === 'error') {
    return (
      <div className="export-error" role="alert">
        <strong>{t('export.initializationFailed')}</strong>
        <button className="button button--secondary" type="button" onClick={() => { void values.load() }}>{t('export.retry')}</button>
      </div>
    )
  }
  if (!values.capabilities) return <p className="export-message" role="status">{t('export.initializing')}</p>
  if (!values.capabilities.formats.length) return <p className="export-message" role="status">{t('export.noFormats')}</p>

  return (
    <>
      <ExportSettingsFields
        preferences={values.preferences}
        capabilities={values.capabilities}
        destinationApproved={values.destinationApproved}
        pickingDestination={values.pickingDestination}
        language={language}
        onChange={values.change}
        onPickDestination={() => { void values.chooseDestination(t('export.choose')) }}
      />
      {values.saveError && <div className="export-error" role="alert"><strong>{t('export.preferencesFailed')}</strong></div>}
      {values.destinationError && <div className="export-error" role="alert"><strong>{t('export.destinationFailed')}</strong></div>}
    </>
  )
}

export function ExportPreferencesPanel() {
  const { i18n, t } = useTranslation()
  const language = i18n.resolvedLanguage?.startsWith('ja') ? 'ja' : 'en'
  const headingId = useId()
  const values = useExportPreferences()

  return (
    <section className="export-preferences-panel" aria-labelledby={headingId}>
      <h2 id={headingId}>{t('export.export')}</h2>
      <ExportPreferencesContent values={values} language={language} />
    </section>
  )
}
