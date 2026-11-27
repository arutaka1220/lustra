import 'i18next'
import type { common } from './common'
import type { english } from './locales/english'

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation'
    resources: {
      translation: typeof english
      common: typeof common
    }
    returnNull: false
    strictKeyChecks: true
  }
}
