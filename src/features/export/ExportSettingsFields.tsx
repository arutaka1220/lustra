import { ChevronDown, FolderOpen } from 'lucide-react'
import { useId } from 'react'
import { SliderInput } from '../editor/SliderInput'
import { exportFormats, exportSizes, getExportSettings, metadataFields } from './export-model'
import type { ExportCapabilities, ExportFormat, ExportPreferences, ExportSize } from './export-model'
import type { exportCopy } from './export-copy'
import { SelectField } from '../../components/ui/SelectField'

type Props = {
  preferences: ExportPreferences
  capabilities: ExportCapabilities
  destinationApproved: boolean
  pickingDestination: boolean
  language: string
  copy: typeof exportCopy.en
  onChange: <K extends keyof ExportPreferences>(field: K, value: ExportPreferences[K]) => void
  onPickDestination: () => void
}

const formatLabels: Record<ExportFormat, string> = { jpeg: 'JPEG', png: 'PNG', webp: 'WebP' }

export function ExportSettingsFields({
  preferences,
  capabilities,
  destinationApproved,
  pickingDestination,
  language,
  copy,
  onChange,
  onPickDestination,
}: Props) {
  const settings = getExportSettings(preferences, capabilities)
  const canKeepMetadata = capabilities.metadataFormats.includes(settings.format)
  const canKeepProfile = capabilities.iccFormats.includes(settings.format)
  const formatter = new Intl.NumberFormat(language, { useGrouping: false })
  const destinationLabel = useId()
  const destinationHelp = useId()

  return (
    <>
      <div className="export-form__basics">
        <label className="export-field">
          <span>{copy.format}</span>
          <SelectField value={settings.format} onValueChange={(value) => onChange('format', value as ExportFormat)} options={exportFormats.map((format) => {
              const supported = capabilities.formats.includes(format)
              return { value: format, label: `${formatLabels[format]}${!supported ? ` · ${copy.unavailable}` : ''}`, disabled: !supported }
            })} />
        </label>
        <label className="export-field">
          <span>{copy.size}</span>
          <SelectField
            value={String(settings.size)}
            onValueChange={(value) => {
              onChange('size', value === 'original' ? value : Number(value) as ExportSize)
            }}
            options={exportSizes.map((size) => ({
              value: String(size), label: size === 'original' ? copy.original : copy.shortEdge(formatter.format(size)),
            }))}
          />
        </label>
      </div>
      <div className="export-field">
        <span id={destinationLabel}>{copy.destination}</span>
        <div className="export-destination" role="group" aria-labelledby={destinationLabel}>
          <span className={preferences.destination ? 'export-destination__path' : 'muted'} title={preferences.destination || undefined}>
            {preferences.destination || copy.destinationPlaceholder}
          </span>
          <button
            className="button button--secondary"
            type="button"
            onClick={onPickDestination}
            disabled={pickingDestination}
            aria-describedby={preferences.destination && !destinationApproved ? destinationHelp : undefined}
          >
            <FolderOpen size={16} aria-hidden="true" /> {copy.choose}
          </button>
        </div>
        {preferences.destination && !destinationApproved && <small id={destinationHelp}>{copy.reselectDestination}</small>}
      </div>
      <details className="export-advanced">
        <summary><ChevronDown size={16} aria-hidden="true" /> {copy.advanced}</summary>
        <div className="export-advanced__content">
          {settings.format !== 'png' && (
            <SliderInput label={copy.quality} min={1} max={100} value={settings.quality} onChange={(quality) => onChange('quality', quality)} />
          )}
          <label className="export-field">
            <span>{copy.colorProfile}</span>
            <SelectField
              value={settings.colorSpace}
              onValueChange={(value) => onChange('colorSpace', value as ExportPreferences['colorSpace'])}
              disabled={!canKeepProfile}
              options={[
                { value: 'srgb', label: copy.srgb },
                { value: 'original', label: copy.originalProfile },
              ]}
            />
            {!canKeepProfile && <small>{copy.profileUnavailable}</small>}
          </label>
          <fieldset className="export-metadata">
            <legend>{copy.metadata}</legend>
            {!canKeepMetadata && <small>{copy.metadataUnavailable}</small>}
            <div className="export-metadata__options">
              {metadataFields.map((field) => (
                <label key={field} className="export-checkbox">
                  <input type="checkbox" checked={settings[field]} disabled={!canKeepMetadata} onChange={(event) => onChange(field, event.target.checked)} />
                  {copy[field]}
                </label>
              ))}
            </div>
            <label className="export-checkbox">
              <input
                type="checkbox"
                checked={settings.applyMetadataCorrections}
                disabled={!canKeepMetadata || (!settings.keepCamera && !settings.keepLens)}
                onChange={(event) => onChange('applyMetadataCorrections', event.target.checked)}
              />
              {copy.applyMetadataCorrections}
            </label>
          </fieldset>
        </div>
      </details>
    </>
  )
}
