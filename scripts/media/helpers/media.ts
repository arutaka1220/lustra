import { createHash } from 'node:crypto'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { mkdir, copyFile } from 'node:fs/promises'

export const SCREEN_SCENES = ['hero', 'frame-styles', 'ambient-gradient', 'edge-stretch', 'portrait-card', 'crop-and-rotate', 'custom-color', 'metadata', 'import', 'review', 'export', 'metadata-corrections'] as const
export const EXAMPLE_FILES = ['white.png', 'soft-white.png', 'black.png', 'soft-black.png', 'custom.png', 'blurred.png', 'ambient-gradient.png', 'edge-stretch.png', 'portrait-card.png'] as const

function escapeHtml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
}

export type MediaManifestFile = {
  path: string
  result: 'success' | 'failed'
  status: 'added' | 'changed' | 'unchanged' | 'failed'
  width?: number
  height?: number
  bytes?: number
  sha256?: string
  hasAlpha?: boolean
  sizeBeforeOptimization?: number
  sizeAfterOptimization?: number
  optimizationBytesSaved?: number
  error?: string
}

export function createManifest(input: {
  generatedAt: string
  sourceCommit: string
  appVersion: string
  kind: string
  languages: string[]
  scene: string
  tools: Record<string, string>
  files: MediaManifestFile[]
  errors?: string[]
  warnings?: string[]
}) {
  const totalBytes = input.files.reduce((sum, file) => sum + (file.bytes ?? 0), 0)
  const totalBytesBeforeOptimization = input.files.reduce((sum, file) => sum + (file.sizeBeforeOptimization ?? file.bytes ?? 0), 0)
  return {
    ...input,
    errors: input.errors ?? [],
    warnings: input.warnings ?? [],
    runResult: input.errors?.length ? 'failed' : 'success',
    successCount: input.files.filter((file) => file.result === 'success').length,
    failureCount: input.files.filter((file) => file.result === 'failed').length || (input.errors?.length ? 1 : 0),
    totalBytes,
    totalBytesBeforeOptimization,
    totalBytesSaved: totalBytesBeforeOptimization - totalBytes,
  }
}

export function windowDecorationSize(width: number, height: number, scale = 2) {
  const margin = 32 * scale, titlebar = 28 * scale, radius = 12 * scale
  return { width: width + margin * 2, height: height + titlebar + margin * 2, margin, titlebar, radius }
}

export function wrapScreenshotSvg(pngDataUri: string, width: number, height: number) {
  const d = windowDecorationSize(width, height)
  const x = d.margin, y = d.margin + d.titlebar
  const safe = pngDataUri.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${d.width}" height="${d.height}" viewBox="0 0 ${d.width} ${d.height}"><defs><filter id="shadow" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="8" stdDeviation="12" flood-color="#000" flood-opacity=".16"/></filter><clipPath id="window"><rect x="${x}" y="${d.margin}" width="${width}" height="${height + d.titlebar}" rx="${d.radius}"/></clipPath></defs><g filter="url(#shadow)"><rect x="${x}" y="${d.margin}" width="${width}" height="${height + d.titlebar}" rx="${d.radius}" fill="#f7f7f7"/><g clip-path="url(#window)"><rect x="${x}" y="${d.margin}" width="${width}" height="${d.titlebar}" fill="#f4f4f4"/><circle cx="${x + 16}" cy="${d.margin + 14}" r="5" fill="#ff5f57"/><circle cx="${x + 34}" cy="${d.margin + 14}" r="5" fill="#febc2e"/><circle cx="${x + 52}" cy="${d.margin + 14}" r="5" fill="#28c840"/><text x="${x + width / 2}" y="${d.margin + 18}" text-anchor="middle" font-family="Inter, sans-serif" font-size="13" fill="#555">Lustra</text><image href="${safe}" x="${x}" y="${y}" width="${width}" height="${height}"/></g></g></svg>`
}

export async function inspectPng(path: string) {
  const bytes = await readFile(path)
  if (bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error(`Not a PNG: ${path}`)
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20)
  if (width < 100 || height < 100) throw new Error(`Image dimensions are implausible: ${path}`)
  const hasAlpha = bytes[25] === 4 || bytes[25] === 6
  const digest = createHash('sha256').update(bytes).digest('hex')
  const size = (await stat(path)).size
  return { width, height, hasAlpha, sha256: digest, bytes: size }
}

export async function writeReport(root: string, files: Array<{ path: string; source?: string; before?: string; sizeBeforeOptimization?: number; sizeAfterOptimization?: number }>, outDir: string, options: { failureCount?: number; errors?: Array<{ path?: string; message: string }>; warnings?: string[] } = {}) {
  const entries = await Promise.all(files.map(async (file) => {
    const path = resolve(root, file.source ?? file.path)
    const info = await inspectPng(path)
    return { ...file, ...info, bytesSaved: (file.sizeBeforeOptimization ?? info.bytes) - (file.sizeAfterOptimization ?? info.bytes) }
  }))
  const manifest = { files: entries, successCount: entries.length, failureCount: options.failureCount ?? 0, errors: options.errors ?? [], warnings: options.warnings ?? [], totalBytes: entries.reduce((sum, entry) => sum + entry.bytes, 0), totalBytesBeforeOptimization: entries.reduce((sum, entry) => sum + (entry.sizeBeforeOptimization ?? entry.bytes), 0), totalBytesSaved: entries.reduce((sum, entry) => sum + entry.bytesSaved, 0) }
  const mediaDir = join(outDir, 'media'); await mkdir(mediaDir, { recursive: true })
  const beforeDir = join(outDir, 'before'); await mkdir(beforeDir, { recursive: true })
  for (const [index, entry] of entries.entries()) {
    await copyFile(resolve(root, entry.source ?? entry.path), join(mediaDir, `${index}.png`))
    if (entry.before) await copyFile(resolve(root, entry.before), join(beforeDir, `${index}.png`))
  }
  const grouped = [
    ['Japanese screenshots', entries.map((entry, index) => ({ entry, index })).filter(({ entry }) => entry.path.includes('/ja/'))],
    ['English screenshots', entries.map((entry, index) => ({ entry, index })).filter(({ entry }) => entry.path.includes('/en/'))],
    ['Export examples', entries.map((entry, index) => ({ entry, index })).filter(({ entry }) => entry.path.includes('/examples/'))],
  ] as const
  const cards = grouped.filter(([, items]) => items.length).map(([title, items]) => `<section><h2>${title}</h2>${items.map(({ entry, index }) => `<article><h3>${escapeHtml(entry.path)}</h3><p>${entry.width} × ${entry.height} · ${(entry.bytes / 1024 / 1024).toFixed(2)} MiB · lossless optimization: ${(entry.sizeBeforeOptimization ?? entry.bytes) - entry.bytes} bytes saved · SHA-256 ${entry.sha256} · ${entry.before ? 'changed' : 'added'}</p>${entry.before ? `<details open><summary>Before / After</summary><img src="before/${index}.png" alt="Before"><img src="media/${index}.png" alt="After"></details>` : `<img src="media/${index}.png" alt="${escapeHtml(entry.path)}">`}</article>`).join('\n')}</section>`).join('\n')
  await writeFile(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2))
  const failures = (options.errors ?? []).length ? `<section><h2>Errors</h2><ul>${options.errors!.map((error) => `<li>${error.path ? `<strong>${escapeHtml(error.path)}</strong>: ` : ''}${escapeHtml(error.message)}</li>`).join('')}</ul></section>` : ''
  const warnings = (options.warnings ?? []).length ? `<section><h2>Warnings</h2><ul>${options.warnings!.map((warning) => `<li>${escapeHtml(warning)}</li>`).join('')}</ul></section>` : ''
  await writeFile(join(outDir, 'report.html'), `<!doctype html><meta charset="utf-8"><title>Documentation Media Pipeline</title><style>body{font:16px system-ui;margin:2rem;background:#f5f5f5}article{background:white;padding:1rem;margin:1rem 0;border-radius:12px}img{max-width:min(100%,1200px);height:auto;object-fit:contain}h2{font-size:1.25rem}h3{font-size:1rem}details img{width:48%;vertical-align:top}</style><h1>Documentation Media Pipeline</h1><p>${entries.length} succeeded · ${options.failureCount ?? 0} failed · ${(manifest.totalBytes / 1024 / 1024).toFixed(2)} MiB · ${(manifest.totalBytesSaved / 1024 / 1024).toFixed(2)} MiB saved by lossless optimization</p>${failures}${warnings}${cards}`)
  return manifest
}
