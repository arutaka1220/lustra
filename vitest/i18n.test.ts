import { describe, expect, it } from 'vitest'
import i18n from '../src/i18n'
import { common } from '../src/i18n/common'
import { english } from '../src/i18n/locales/english'
import { japanese } from '../src/i18n/locales/japanese'
import { findTranslationIssues, flattenTranslationLeaves } from '../src/i18n/validation'

describe('centralized translation dictionaries', () => {
  it('keeps all English and Japanese keys and interpolation variables aligned', () => {
    expect(findTranslationIssues(english, japanese)).toEqual([])
  })

  it('reports missing, unexpected, empty, and mismatched interpolation entries', () => {
    const issues = findTranslationIssues(
      { actions: { save: 'Save', delete: 'Delete', empty: 'Not empty', interpolation: 'Delete {{name}}' } },
      { actions: { save: '保存', extra: '余分', empty: '', interpolation: '削除' } },
    )
    expect(issues).toEqual(expect.arrayContaining([
      'Missing Japanese translation: actions.delete',
      'Unexpected Japanese key: actions.extra',
      'Empty translation: actions.empty',
      'Interpolation mismatch: actions.interpolation',
    ]))
  })

  it('keeps the common namespace collision-free and complete', () => {
    const localeKeys = new Set([...Object.keys(flattenTranslationLeaves(english)), ...Object.keys(flattenTranslationLeaves(japanese))])
    const commonKeys = Object.keys(flattenTranslationLeaves(common))
    expect(commonKeys.filter((key) => localeKeys.has(key))).toEqual([])
    expect(flattenTranslationLeaves(common)).toMatchObject({
      'app.name': 'Lustra',
      'frames.ambientGradient': 'Ambient Gradient',
      'formats.jpeg': 'JPEG',
    })
  })

  it('uses shared English frame style names regardless of the selected language', async () => {
    for (const language of ['en', 'ja'] as const) {
      await i18n.changeLanguage(language)
      expect(i18n.t('frames.softBlack', { ns: 'common' })).toBe('Soft Black')
      expect(i18n.t('frames.ambientGradient', { ns: 'common' })).toBe('Ambient Gradient')
    }
  })

  it('formats Japanese photo counts and progress in natural word order', async () => {
    await i18n.changeLanguage('ja')
    expect(i18n.t('import.confirmCount', { count: 12 })).toBe('12枚の写真を読み込む')
    expect(i18n.t('edit.completion', { count: 8, total: 12 })).toBe('12枚中8枚が完了')
    expect(i18n.t('session.photoCount', { count: 1 })).toBe('1枚')
  })

  it('shows the Japanese translation for user facing errors', async () => {
    await i18n.changeLanguage('ja')
    expect(i18n.t('session.relinkError')).toBe('選択した場所を開けませんでした。')
    expect(i18n.t('settings.preferenceError')).toBe('設定を保存できませんでした。')
  })

  it('does not return untranslated keys or empty strings for locale entries', () => {
    for (const [locale, dictionary] of [['en', english], ['ja', japanese]] as const) {
      for (const [key, text] of Object.entries(flattenTranslationLeaves(dictionary))) {
        expect(text.trim(), `${locale}:${key}`).not.toBe('')
        expect(text, `${locale}:${key}`).not.toBe(key)
      }
    }
  })

  it('allows only documented shared strings to remain identical across languages', () => {
    const en = flattenTranslationLeaves(english)
    const ja = flattenTranslationLeaves(japanese)
    const identical = Object.keys(en).filter((key) => en[key] === ja[key]).sort()
    expect(identical).toEqual([
      'app.title',
      'framePreview.ambientGradient',
      'framePreview.black',
      'framePreview.blurred',
      'framePreview.custom',
      'framePreview.edgeStretch',
      'framePreview.none',
      'framePreview.softBlack',
      'framePreview.softWhite',
      'framePreview.white',
      'text.corrections.ruleSummary',
      'text.metadata.iso',
      'welcome.eyebrow',
    ])
  })

  it('registers every Japanese key in the Japanese runtime bundle without English fallback', () => {
    const japaneseKeys = Object.keys(flattenTranslationLeaves(japanese))
    for (const key of japaneseKeys) expect(i18n.exists(key, { lng: 'ja' }), key).toBe(true)
  })
})
