/** Formats EXIF/XMP capture timestamps without interpreting their offset as a timezone conversion. */
export function formatCaptureDate(value: string | undefined, locale = 'en'): string | undefined {
  if (!value) return undefined
  const match = value.trim().match(/^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:[.,](\d+))?(?:\s*(Z|[+-]\d{2}:?\d{2}))?$/i)
  if (!match) return value
  const [, y, mo, d, h, mi, s] = match
  const parts = [y, mo, d, h, mi, s].map(Number)
  const [year, month, day, hour, minute, second] = parts
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day || hour > 23 || minute > 59 || second > 59) return value
  if (locale.toLowerCase().startsWith('ja')) {
    return `${y}/${mo}/${d} ${h}:${mi}:${s}`
  }
  return new Intl.DateTimeFormat(locale, {
    timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).format(date)
}
