import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { common } from './common'
import { english } from './locales/english'
import { japanese } from './locales/japanese'

const savedLanguage = typeof localStorage === 'undefined' ? null : localStorage.getItem('lustra.language')
const initialLanguage = savedLanguage === 'ja' ? 'ja' : 'en'

void i18n.use(initReactI18next).init({
  lng: initialLanguage,
  fallbackLng: 'en',
  supportedLngs: ['en', 'ja'],
  defaultNS: 'translation',
  resources: {
    en: { translation: english, common },
    ja: { translation: japanese, common },
  },
  interpolation: { escapeValue: false },
})

export { common, english, i18n, japanese }
export default i18n
