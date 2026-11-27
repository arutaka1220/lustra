import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createManifest, windowDecorationSize, writeReport } from '../scripts/media/helpers/media'
import { parseArgs, safeOutputPath } from '../scripts/media/cli'

describe('Documentation Media Pipeline frame geometry', () => {
  it('converts the requested macOS frame and margin to 2x pixels', () => {
    expect(windowDecorationSize(2880, 1800)).toEqual({ width: 3008, height: 1984, margin: 64, titlebar: 56, radius: 24 })
  })
})

describe('Documentation Media Pipeline CLI validation', () => {
  it('selects one scene and one language from the allowlists', () => {
    expect(parseArgs(['screenshots', '--language', 'ja', '--scene', 'portrait-card'])).toEqual({ kind: 'screenshots', languages: ['ja'], scene: 'portrait-card' })
  })

  it('rejects unknown scenes, languages, and flags', () => {
    expect(() => parseArgs(['--scene', 'not-a-scene'])).toThrow(/Unknown scene/)
    expect(() => parseArgs(['--language', 'fr'])).toThrow(/Unsupported language/)
    expect(() => parseArgs(['--unsafe'])).toThrow(/Unknown argument/)
  })

  it('refuses output paths that escape the repository', () => {
    expect(() => safeOutputPath('../../outside.png')).toThrow(/escapes repository/)
  })

  it('creates manifests with per-file results, version metadata, and byte totals', () => {
    const manifest = createManifest({
      generatedAt: '2026-01-02T03:04:05.000Z',
      sourceCommit: 'abc123',
      appVersion: '1.0.0',
      kind: 'screenshots',
      languages: ['ja'],
      scene: 'hero',
      tools: { bun: '1.3.0' },
      files: [
        { path: 'docs/assets/screenshots/ja/hero.png', result: 'success', status: 'changed', bytes: 80, sizeBeforeOptimization: 100 },
        { path: 'docs/assets/screenshots/ja/frame-styles.png', result: 'failed', status: 'failed', error: 'capture failed' },
      ],
      errors: ['capture failed'],
    })
    expect(manifest).toMatchObject({ runResult: 'failed', successCount: 1, failureCount: 1, totalBytes: 80, totalBytesBeforeOptimization: 100, totalBytesSaved: 20 })
    expect(manifest.files[0]?.path).not.toMatch(/^\//)
  })

  it('writes an offline report with image hashes, totals, and before/after views', async () => {
    const root = resolve(process.cwd())
    const output = await mkdtemp(join(tmpdir(), 'lustra-media-report-'))
    const image = 'docs/assets/screenshots/ja/hero.png'
    try {
      const imageBytes = (await stat(resolve(root, image))).size
      const manifest = await writeReport(root, [{ path: image, source: image, before: image, sizeBeforeOptimization: imageBytes + 100, sizeAfterOptimization: imageBytes }], output, { failureCount: 1, errors: [{ path: image, message: '<unsafe & invalid>' }], warnings: ['warning'] })
      expect(manifest.totalBytes).toBe(imageBytes)
      expect(manifest.totalBytesBeforeOptimization).toBe(imageBytes + 100)
      expect(manifest.totalBytesSaved).toBe(100)
      expect(manifest.files[0]).toMatchObject({ path: image, sizeBeforeOptimization: imageBytes + 100, sizeAfterOptimization: imageBytes, bytesSaved: 100 })
      expect(manifest.files[0]?.sha256).toMatch(/^[a-f0-9]{64}$/)
      expect(await readFile(join(output, 'report.html'), 'utf8')).toContain('Before / After')
      expect(await readFile(join(output, 'report.html'), 'utf8')).toContain('&lt;unsafe &amp; invalid&gt;')
      expect(await readFile(join(output, 'media/0.png'))).toEqual(await readFile(resolve(root, image)))
      expect(await readFile(join(output, 'before/0.png'))).toEqual(await readFile(resolve(root, image)))
    } finally {
      await rm(output, { recursive: true, force: true })
    }
  })
})
