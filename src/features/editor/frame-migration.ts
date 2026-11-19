const legacyCanvasKeys = ['ratio', 'ratioWidth', 'ratioHeight', 'fit'] as const

export function hasLegacyCanvasSettings(value: object): boolean {
  return legacyCanvasKeys.some((key) => Object.hasOwn(value, key))
}

export function withoutLegacyCanvasSettings<T extends object>(value: T): Omit<T, (typeof legacyCanvasKeys)[number]> {
  const clean = { ...value } as Record<string, unknown>
  legacyCanvasKeys.forEach((key) => { delete clean[key] })
  return clean as Omit<T, (typeof legacyCanvasKeys)[number]>
}

export function withoutLegacyCrop<T extends object>(value: T): Omit<T, 'crop'> {
  const clean = { ...value } as Record<string, unknown>
  delete clean.crop
  return clean as Omit<T, 'crop'>
}
