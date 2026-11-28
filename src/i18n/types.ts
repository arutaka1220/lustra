import type { common } from './common'
import type { english } from './locales/english'

type WidenStrings<T> = T extends string ? string : { [K in keyof T]: WidenStrings<T[K]> }
export type TranslationSchema = WidenStrings<typeof english>
export type Locale = 'en' | 'ja'
export type CommonDictionary = typeof common
export type Dictionary = typeof common & TranslationSchema

type LeafPaths<T, Prefix extends string = ''> = {
  [K in keyof T & string]: T[K] extends string
    ? `${Prefix}${K}`
    : LeafPaths<T[K], `${Prefix}${K}.`>
}[keyof T & string]

export type CommonTranslationKey = `common:${LeafPaths<CommonDictionary>}`
export type TranslationSchemaKey = LeafPaths<TranslationSchema>
export type TranslationKey = TranslationSchemaKey | CommonTranslationKey

export type InterpolationNames<S extends string> = S extends `${string}{{${infer Name}}}${infer Rest}`
  ? Name | InterpolationNames<Rest>
  : never

export type InterpolationsMatch<English extends string, Japanese extends string> =
  [InterpolationNames<English>] extends [InterpolationNames<Japanese>]
    ? [InterpolationNames<Japanese>] extends [InterpolationNames<English>] ? true : false
    : false

export type { common }
