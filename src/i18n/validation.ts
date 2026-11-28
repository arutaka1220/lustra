type TranslationTree = Readonly<Record<string, unknown>>

export function flattenTranslationLeaves(tree: TranslationTree, prefix = ''): Record<string, string> {
  return Object.entries(tree).reduce<Record<string, string>>((result, [key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key
    if (typeof value === 'string') result[path] = value
    else if (value && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(result, flattenTranslationLeaves(value as TranslationTree, path))
    }
    return result
  }, {})
}

export function findTranslationIssues(english: TranslationTree, japanese: TranslationTree): string[] {
  const en = flattenTranslationLeaves(english)
  const ja = flattenTranslationLeaves(japanese)
  const issues: string[] = []
  const enKeys = new Set(Object.keys(en))
  const jaKeys = new Set(Object.keys(ja))
  for (const key of enKeys) if (!jaKeys.has(key)) issues.push(`Missing Japanese translation: ${key}`)
  for (const key of jaKeys) if (!enKeys.has(key)) issues.push(`Unexpected Japanese key: ${key}`)
  const variables = (text: string) => [...text.matchAll(/{{\s*([^{}]+?)\s*}}/g)].map((match) => match[1]).sort().join('|')
  for (const key of enKeys) {
    const enText = en[key]
    const jaText = ja[key]
    if (jaText === undefined) continue
    if (!enText.trim() || !jaText.trim()) issues.push(`Empty translation: ${key}`)
    if (variables(enText) !== variables(jaText)) issues.push(`Interpolation mismatch: ${key}`)
  }
  return issues
}
