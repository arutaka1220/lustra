import { readFileSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createPrBody, expectedPaths, isAllowedGeneratedPath, validateConfig } from '../scripts/media/workflow'
import { writeReport } from '../scripts/media/helpers/media'

describe('Documentation Media Pipeline workflow configuration', () => {
  it('requires workflow dispatch from main', () => {
    expect(() => validateConfig({ ref: 'refs/heads/feature', mediaType: 'all', language: 'both', scene: 'all' }))
      .toThrow('only run from main')
  })

  it('validates each input against the allowlist', () => {
    expect(() => validateConfig({ ref: 'refs/heads/main', mediaType: 'anything', language: 'both', scene: 'all' }))
      .toThrow('Unsupported media type')
    expect(() => validateConfig({ ref: 'refs/heads/main', mediaType: 'all', language: 'fr', scene: 'all' }))
      .toThrow('Unsupported language')
    expect(() => validateConfig({ ref: 'refs/heads/main', mediaType: 'all', language: 'both', scene: 'crop/../../README.md' }))
      .toThrow('Unknown screenshot scene')
  })

  it('expands all media to 33 exact PNG paths', () => {
    const config = validateConfig({ ref: 'refs/heads/main', mediaType: 'all', language: 'both', scene: 'all' })
    expect(config.count).toBe(33)
    expect(config.paths).toHaveLength(33)
    expect(config.paths.every((path) => path.endsWith('.png'))).toBe(true)
    expect(config.paths).toContain('docs/assets/screenshots/ja/hero.png')
    expect(config.paths).toContain('docs/assets/screenshots/en/metadata-corrections.png')
    expect(config.paths).toContain('docs/assets/examples/portrait-card.png')
  })

  it('selects one language and one scene independently', () => {
    const config = validateConfig({ ref: 'refs/heads/main', mediaType: 'screenshots', language: 'en', scene: 'crop-and-rotate' })
    expect(config.languages).toEqual(['en'])
    expect(config.scenes).toEqual(['crop-and-rotate'])
    expect(config.paths).toEqual(['docs/assets/screenshots/en/crop-and-rotate.png'])
    expect(expectedPaths('examples', 'both', 'all')).toHaveLength(9)
  })

  it('only permits the fixed generated PNG paths', () => {
    expect(isAllowedGeneratedPath('docs/assets/screenshots/ja/hero.png')).toBe(true)
    expect(isAllowedGeneratedPath('docs/assets/examples/portrait-card.png')).toBe(true)
    expect(isAllowedGeneratedPath('docs/assets/screenshots/ja/README.md')).toBe(false)
    expect(isAllowedGeneratedPath('docs/assets/screenshots/en/unknown.png')).toBe(false)
    expect(isAllowedGeneratedPath('docs/assets/examples/../../README.png')).toBe(false)
    expect(isAllowedGeneratedPath('README.md')).toBe(false)
  })

  it('rejects contradictory unused inputs for examples', () => {
    expect(() => validateConfig({ ref: 'refs/heads/main', mediaType: 'examples', language: 'ja', scene: 'all' }))
      .toThrow('must remain at their defaults')
    expect(() => validateConfig({ ref: 'refs/heads/main', mediaType: 'examples', language: 'both', scene: 'hero' }))
      .toThrow('must remain at their defaults')
  })
})

describe('Documentation Media Pipeline workflow policy', () => {
  const workflow = readFileSync(resolve(process.cwd(), '.github/workflows/documentation-media.yml'), 'utf8')

  it('uses manual dispatch only, read-only default permissions, and non-cancelling concurrency', () => {
    expect(workflow).toContain('workflow_dispatch:')
    expect(workflow).toContain('contents: read')
    expect(workflow).toContain('group: documentation-media')
    expect(workflow).toContain('cancel-in-progress: false')
    expect(workflow.match(/include-hidden-files: true/g)).toHaveLength(5)
    expect(workflow).not.toMatch(/^  (push|pull_request|release|pull_request_target):/m)
    expect(workflow).not.toContain('pull_request_target')
  })

  it('confines the Environment and App credentials to the dependent PR job', () => {
    expect(workflow.match(/^    environment:\n      name: documentation-media$/gm)).toHaveLength(1)
    expect(workflow).toContain('needs: [validate, process]')
    expect(workflow).toContain("needs.process.outputs.changed == 'true'")
    expect(workflow).toContain('LUSTRA_BOT_PRIVATE_KEY')
    expect(workflow).toContain('LUSTRA_BOT_CLIENT_ID')
    expect(workflow).toContain('actions/create-github-app-token@64ab729a6294000f5aa4a4bc0b73d1f32bc45510')
    expect(workflow).not.toContain('pull_request_target')
  })

  it('keeps screenshot generation and processing on Ubuntu and native examples on macOS', () => {
    expect(workflow).toMatch(/screenshots:[\s\S]*?runs-on: ubuntu-24\.04/)
    expect(workflow).toMatch(/examples:[\s\S]*?runs-on: macos-15/)
    expect(workflow).toMatch(/process:[\s\S]*?runs-on: ubuntu-24\.04/)
    expect(workflow).toContain('retention-days: 30')
  })
})

describe('Documentation Media Pipeline PR body', () => {
  const base = {
    repo: 'arutaka1220/lustra',
    baseSha: 'a'.repeat(40),
    resultSha: 'b'.repeat(40),
    runUrl: 'https://github.com/arutaka1220/lustra/actions/runs/123',
    runId: '123',
  }

  it('embeds changed image comparisons and collapses non-hero groups', () => {
    const body = createPrBody({
      ...base,
      manifest: {
        kind: 'screenshots', languages: ['ja', 'en'], scene: 'all',
        files: [
          { path: 'docs/assets/screenshots/ja/hero.png', result: 'success', status: 'changed', sha256: 'c'.repeat(64), width: 1000, height: 800, bytes: 100 },
          { path: 'docs/assets/screenshots/en/crop-and-rotate.png', result: 'success', status: 'added', sha256: 'd'.repeat(64), width: 1000, height: 800, bytes: 100 },
          { path: 'docs/assets/screenshots/ja/import.png', result: 'success', status: 'unchanged', sha256: 'e'.repeat(64), width: 1000, height: 800, bytes: 100 },
        ],
      },
    })
    expect(body).toContain(`raw.githubusercontent.com/arutaka1220/lustra/${base.baseSha}/docs/assets/screenshots/ja/hero.png`)
    expect(body).toContain(`raw.githubusercontent.com/arutaka1220/lustra/${base.resultSha}/docs/assets/screenshots/ja/hero.png`)
    expect(body).toContain('<details><summary>English screenshots')
    expect(body).not.toContain('screenshots/ja/import.png')
    expect(body).toContain(base.runUrl)
  })

  it('shows only after images for additions', () => {
    const body = createPrBody({
      ...base,
      manifest: {
        kind: 'examples', languages: [], scene: 'all',
        files: [{ path: 'docs/assets/examples/white.png', result: 'success', status: 'added', sha256: 'f'.repeat(64), width: 1440, height: 1000, bytes: 100 }],
      },
    })
    expect(body).toContain('| After |')
    expect(body).not.toContain('| Before |')
  })
})

describe('Documentation Media Pipeline report', () => {
  it('preserves added, changed, and unchanged comparisons in the HTML report', async () => {
    const reportDir = await mkdtemp(join(tmpdir(), 'lustra-media-report-'))
    try {
      const root = process.cwd()
      await writeReport(root, [
        { path: 'docs/assets/examples/white.png', source: 'docs/assets/examples/white.png', before: 'docs/assets/examples/white.png', status: 'unchanged' },
        { path: 'docs/assets/examples/black.png', source: 'docs/assets/examples/black.png', before: 'docs/assets/examples/white.png', status: 'changed' },
        { path: 'docs/assets/examples/soft-white.png', source: 'docs/assets/examples/soft-white.png', status: 'added' },
      ], reportDir)
      const html = await readFile(join(reportDir, 'report.html'), 'utf8')
      expect(html).toContain('unchanged')
      expect(html).toContain('changed')
      expect(html).toContain('added')
    } finally {
      await rm(reportDir, { recursive: true, force: true })
    }
  })
})
