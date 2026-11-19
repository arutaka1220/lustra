import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SelectField } from '../../components/ui/SelectField'
import { useMetadataCorrections } from './metadata-corrections-store'
import { isValidCorrectionPattern } from './text-model'
import type { MetadataCorrectionMode, MetadataCorrectionRule, MetadataCorrectionsState } from './text-model'
import './text.css'

const modes: MetadataCorrectionMode[] = ['exact', 'partial', 'regex']

function CorrectionRules({ category }: { category: keyof MetadataCorrectionsState }) {
  const { t } = useTranslation()
  const heading = useId()
  const rules = useMetadataCorrections((state) => state.corrections[category])
  const setRules = useMetadataCorrections((state) => state.setRules)
  const [draft, setDraft] = useState<MetadataCorrectionRule | null>(null)
  const valid = draft && isValidCorrectionPattern(draft.mode, draft.pattern)

  return (
    <section className="correction-rules" aria-labelledby={heading}>
      <h3 id={heading}>{t(`text.corrections.${category}`)}</h3>
      {rules.length === 0 && <p className="text-hint">{t('text.corrections.noRules')}</p>}
      {rules.length > 0 && <ul className="correction-rule-list">
        {rules.map((rule) => (
          <li key={rule.id}>
            <div>
              <strong>{t('text.corrections.ruleSummary', rule)}</strong>
              <small>{t(`text.corrections.${rule.mode}`)}</small>
            </div>
            <button className="icon-button text-icon-button" type="button" aria-label={t('text.corrections.edit')} onClick={() => setDraft(rule)}><Pencil size={14} /></button>
            <button className="icon-button text-icon-button" type="button" aria-label={t('text.corrections.remove')} onClick={() => {
              setRules(category, rules.filter(({ id }) => id !== rule.id))
              if (draft?.id === rule.id) setDraft(null)
            }}><Trash2 size={14} /></button>
          </li>
        ))}
      </ul>}
      {draft ? (
        <form className="text-fields" onSubmit={(event) => {
          event.preventDefault()
          if (!valid) return
          const nextRules = rules.some(({ id }) => id === draft.id)
            ? rules.map((rule) => rule.id === draft.id ? draft : rule)
            : [...rules, draft]
          setRules(category, nextRules)
          setDraft(null)
        }}>
          <label>{t('text.corrections.mode')}
            <SelectField className="text-field" value={draft.mode} onValueChange={(value) => setDraft({ ...draft, mode: value as MetadataCorrectionMode })}
              options={modes.map((mode) => ({ value: mode, label: t(`text.corrections.${mode}`) }))} />
          </label>
          <label>{t('text.corrections.pattern')}
            <input className="text-field" required value={draft.pattern} onChange={(event) => setDraft({ ...draft, pattern: event.target.value })} aria-invalid={Boolean(draft.pattern && !valid)} />
          </label>
          <label>{t('text.corrections.replacement')}
            <input className="text-field" value={draft.replacement} onChange={(event) => setDraft({ ...draft, replacement: event.target.value })} />
          </label>
          {draft.pattern && !valid && <p className="text-feedback" role="status">{t('text.corrections.invalid')}</p>}
          <div className="text-actions">
            <button className="button button--primary button--small" disabled={!valid} type="submit">{t('text.corrections.save')}</button>
            <button className="button button--quiet button--small" type="button" onClick={() => setDraft(null)}>{t('text.corrections.cancel')}</button>
          </div>
        </form>
      ) : (
        <button className="button button--secondary button--small" type="button" onClick={() => setDraft({ id: crypto.randomUUID(), mode: 'exact', pattern: '', replacement: '' })}>
          <Plus size={14} /> {t('text.corrections.add')}
        </button>
      )}
    </section>
  )
}

export function MetadataCorrections() {
  const { t } = useTranslation()
  const { status, saveError, load, save } = useMetadataCorrections()

  return (
    <details className="metadata-corrections" onToggle={(event) => { if (event.currentTarget.open) void load() }}>
      <summary>{t('text.corrections')}</summary>
      {status === 'loadError' && <p className="text-feedback" role="status">
        {t('text.corrections.loadError')} <button className="text-button" type="button" onClick={() => void load()}>{t('text.corrections.retry')}</button>
      </p>}
      {(status === 'idle' || status === 'loading') && <p className="text-hint" role="status">{t('text.corrections.loading')}</p>}
      {status === 'ready' && <>
        {saveError && <p className="text-feedback" role="status">
          {t('text.corrections.saveError')} <button className="text-button" type="button" onClick={() => void save()}>{t('text.corrections.retry')}</button>
        </p>}
        <CorrectionRules category="camera" />
        <CorrectionRules category="lens" />
      </>}
    </details>
  )
}
