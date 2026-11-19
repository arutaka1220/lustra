import { isTauri } from '@tauri-apps/api/core'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { exportCopy } from './export-copy'
import { ExportSettingsFields } from './ExportSettingsFields'
import { useExportPreferences } from './useExportPreferences'
import '../../styles/export.css'

type PreferenceValues = ReturnType<typeof useExportPreferences>

export function ExportPreferencesContent({ values, language }: { values: PreferenceValues; language: keyof typeof exportCopy }) {
  const copy = exportCopy[language]
  if (!isTauri()) return <p className="export-message">{copy.browserOnly}</p>
  if (values.status === 'error') {
    return (
      <div className="export-error" role="alert">
        <strong>{copy.initializationFailed}</strong><span>{values.loadError}</span>
        <button className="button button--secondary" type="button" onClick={() => { void values.load() }}>{copy.retry}</button>
      </div>
    )
  }
  if (!values.capabilities) return <p className="export-message" role="status">{copy.initializing}</p>
  if (!values.capabilities.formats.length) return <p className="export-message" role="status">{copy.noFormats}</p>

  return (
    <>
      <ExportSettingsFields
        preferences={values.preferences}
        capabilities={values.capabilities}
        destinationApproved={values.destinationApproved}
        pickingDestination={values.pickingDestination}
        language={language}
        copy={copy}
        onChange={values.change}
        onPickDestination={() => { void values.chooseDestination(copy.choose) }}
      />
      {values.saveError && <div className="export-error" role="alert"><strong>{copy.preferencesFailed}</strong><span>{values.saveError}</span></div>}
      {values.destinationError && <div className="export-error" role="alert"><strong>{copy.destinationFailed}</strong><span>{values.destinationError}</span></div>}
    </>
  )
}

export function ExportPreferencesPanel() {
  const { i18n } = useTranslation()
  const language = i18n.resolvedLanguage?.startsWith('ja') ? 'ja' : 'en'
  const headingId = useId()
  const values = useExportPreferences()

  return (
    <section className="export-preferences-panel" aria-labelledby={headingId}>
      <h2 id={headingId}>{exportCopy[language].export}</h2>
      <ExportPreferencesContent values={values} language={language} />
    </section>
  )
}
