import i18n from './index'

i18n.t('review.export')
i18n.t('import.confirmCount', { count: 12 })
i18n.t('frames.softBlack', { ns: 'common' })
// @ts-expect-error Unknown keys must be rejected by the i18next type augmentation.
i18n.t('review.unknown')
// @ts-expect-error Common dictionary keys use their own typed namespace.
i18n.t('frames.unknown', { ns: 'common' })
