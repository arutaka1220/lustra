#!/usr/bin/env bun
import { createHash } from 'node:crypto'
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createManifest, EXAMPLE_FILES, inspectPng, SCREEN_SCENES, writeReport, type MediaManifestFile } from './helpers/media'
import { validatePublicMetadata } from './cli'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
type MediaType = 'all' | 'screenshots' | 'examples'
type Language = 'ja' | 'en'
type Scene = typeof SCREEN_SCENES[number]

function fail(message: string): never { throw new Error(message) }
function parseMediaType(value: string): MediaType {
  if (value !== 'all' && value !== 'screenshots' && value !== 'examples') fail(`Unsupported media type: ${value}`)
  return value
}
function parseLanguage(value: string): 'both' | Language {
  if (value !== 'both' && value !== 'ja' && value !== 'en') fail(`Unsupported language: ${value}`)
  return value
}
function parseScene(value: string): 'all' | Scene {
  if (value !== 'all' && !SCREEN_SCENES.includes(value as Scene)) fail(`Unknown screenshot scene: ${value}`)
  return value as 'all' | Scene
}
function languagesFor(mediaType: MediaType, language: 'both' | Language): Language[] {
  return mediaType === 'examples' ? [] : language === 'both' ? ['ja', 'en'] : [language]
}
function scenesFor(scene: 'all' | Scene): Scene[] { return scene === 'all' ? [...SCREEN_SCENES] : [scene] }
function expectedPaths(mediaType: MediaType, language: 'both' | Language, scene: 'all' | Scene) {
  const paths: string[] = []
  if (mediaType !== 'examples') for (const lang of languagesFor(mediaType, language)) for (const id of scenesFor(scene)) paths.push(`docs/assets/screenshots/${lang}/${id}.png`)
  if (mediaType !== 'screenshots') for (const name of EXAMPLE_FILES) paths.push(`docs/assets/examples/${name}`)
  return paths.sort()
}
function fixturePaths(mediaType: MediaType) {
  return mediaType === 'examples' ? ['jellyfish.jpg'] : ['aviation.jpg', 'jellyfish.jpg', 'alley.jpg', 'illumination.jpg']
}
function sha256(path: string) { return createHash('sha256').update(readFileSync(path)).digest('hex') }
function assertInside(base: string, candidate: string) {
  const resolvedBase = resolve(base), resolved = resolve(base, candidate)
  if (existsSync(resolvedBase) && lstatSync(resolvedBase).isSymbolicLink()) fail(`Symbolic link directories are not allowed: ${base}`)
  const rel = relative(resolvedBase, resolved)
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) fail(`Unsafe path: ${candidate}`)
  let cursor = resolvedBase
  for (const segment of rel.split(sep)) {
    cursor = join(cursor, segment)
    if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink()) fail(`Symbolic links are not allowed: ${candidate}`)
  }
  if (existsSync(resolved)) {
    const actual = realpathSync(resolved)
    if (!actual.startsWith(`${realpathSync(resolvedBase)}${sep}`)) fail(`Path resolves outside its directory: ${candidate}`)
  }
  return resolved
}
function exiftoolVersion() {
  const result = spawnSync('exiftool', ['-ver'], { encoding: 'utf8' })
  if (result.status !== 0) fail('ExifTool is required to validate media privacy metadata.')
  return result.stdout.trim()
}
function setOutput(name: string, value: string) {
  const output = process.env.GITHUB_OUTPUT
  if (output) writeFileSync(output, `${name}=${value}\n`, { flag: 'a' })
}
function inputConfig() {
  const type = parseMediaType(process.env.MEDIA_TYPE ?? '')
  const language = parseLanguage(process.env.MEDIA_LANGUAGE ?? '')
  const scene = parseScene(process.env.MEDIA_SCENE ?? '')
  if (type === 'examples' && (language !== 'both' || scene !== 'all')) fail('For examples, language and screenshot scene inputs must remain at their defaults.')
  return { type, language, scene }
}

export function validateConfig(input: { ref: string; mediaType: string; language: string; scene: string }) {
  if (input.ref !== 'refs/heads/main') fail('Documentation Media Pipeline can only run from main.')
  const type = parseMediaType(input.mediaType)
  const language = parseLanguage(input.language)
  const scene = parseScene(input.scene)
  if (type === 'examples' && (language !== 'both' || scene !== 'all')) fail('For examples, language and screenshot scene inputs must remain at their defaults.')
  return { type, language, scene, languages: languagesFor(type, language), scenes: type === 'examples' ? [] : scenesFor(scene), paths: expectedPaths(type, language, scene), count: expectedPaths(type, language, scene).length }
}

export function isAllowedGeneratedPath(path: string) {
  return /^docs\/assets\/(?:screenshots\/(?:ja|en)\/(?:hero|frame-styles|ambient-gradient|edge-stretch|portrait-card|crop-and-rotate|custom-color|metadata|import|review|export|metadata-corrections)\.png|examples\/(?:white|soft-white|black|soft-black|custom|blurred|ambient-gradient|edge-stretch|portrait-card)\.png)$/.test(path)
}

async function validateDispatch() {
  const input = { ref: process.env.GITHUB_REF ?? '', mediaType: process.env.MEDIA_TYPE ?? '', language: process.env.MEDIA_LANGUAGE ?? '', scene: process.env.MEDIA_SCENE ?? '' }
  const config = validateConfig(input)
  for (const name of fixturePaths(config.type)) {
    const path = resolve(root, 'scripts/media/fixtures', name)
    if (!existsSync(path) || !lstatSync(path).isFile()) fail(`Missing approved demo photo: scripts/media/fixtures/${name}`)
  }
  validatePublicMetadata(fixturePaths(config.type).map((name) => resolve(root, 'scripts/media/fixtures', name)))
  const sourceCommit = process.env.GITHUB_SHA ?? ''
  if (!/^[0-9a-f]{40}$/i.test(sourceCommit)) fail('The dispatch source commit SHA is invalid.')
  const version = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version as string
  setOutput('media_type', config.type)
  setOutput('language', config.language)
  setOutput('scene', config.scene)
  setOutput('languages', JSON.stringify(config.languages))
  setOutput('expected_count', String(config.count))
  setOutput('source_commit', sourceCommit)
  setOutput('app_version', version)
  console.log(`Validated ${config.type}: ${config.count} files from ${sourceCommit}.`)
}

async function exportGenerated() {
  const config = inputConfig()
  const output = resolve(root, '.media-output')
  rmSyncSafe(output)
  mkdirSync(output, { recursive: true })
  for (const path of expectedPaths(config.type, config.language, config.scene)) {
    const source = assertInside(root, path)
    if (!existsSync(source) || !lstatSync(source).isFile()) fail(`Generated file is missing: ${path}`)
    const destination = assertInside(output, path.replace(/^docs\/assets\//, ''))
    mkdirSync(dirname(destination), { recursive: true })
    cpSync(source, destination)
  }
  const scopes = config.type === 'examples' ? ['examples'] : languagesFor(config.type, config.language)
  const sourceManifest = resolve(root, '.media-tmp/latest-report/manifest.json')
  if (!existsSync(sourceManifest) || !lstatSync(sourceManifest).isFile()) fail('The generation manifest is missing; refusing to upload images without optimizer provenance.')
  for (const scope of scopes) {
    const destination = assertInside(output, `generation-manifest-${scope}.json`)
    cpSync(sourceManifest, destination)
  }
  console.log(`Prepared ${expectedPaths(config.type, config.language, config.scene).length} generated files for upload.`)
}

async function packageArtifacts() {
  const config = inputConfig()
  const paths = expectedPaths(config.type, config.language, config.scene)
  const sourceCommit = process.env.MEDIA_SOURCE_COMMIT ?? ''
  if (!/^[0-9a-f]{40}$/i.test(sourceCommit)) fail('MEDIA_SOURCE_COMMIT must be a full commit SHA.')
  const inputDir = resolve(root, '.media-input')
  const packageDir = resolve(root, '.media-package')
  const expectedArtifactPaths = paths.map((path) => path.replace(/^docs\/assets\//, '')).sort()
  const languages = languagesFor(config.type, config.language)
  const sourceManifestNames: string[] = []
  if (config.type !== 'examples') sourceManifestNames.push(...languages.map((language) => `generation-manifest-${language}.json`))
  if (config.type !== 'screenshots') sourceManifestNames.push('generation-manifest-examples.json')
  expectedArtifactPaths.push(...sourceManifestNames)
  expectedArtifactPaths.sort()
  const actualArtifactPaths: string[] = []
  const inspectInput = (directory: string) => {
    if (!existsSync(directory)) return
    for (const name of readdirSync(directory)) {
      const entry = join(directory, name), info = lstatSync(entry)
      if (info.isSymbolicLink()) fail(`Generated artifact contains a symbolic link: ${relative(inputDir, entry)}`)
      if (info.isDirectory()) inspectInput(entry)
      else {
        const path = relative(inputDir, entry).split(sep).join('/')
        if (!name.toLowerCase().endsWith('.png') && !sourceManifestNames.includes(path)) fail(`Generated artifact contains an unapproved non-PNG file: ${path}`)
        actualArtifactPaths.push(path)
      }
    }
  }
  inspectInput(inputDir)
  if (JSON.stringify(actualArtifactPaths.sort()) !== JSON.stringify(expectedArtifactPaths)) fail(`Generated artifact paths do not match the request. Expected ${expectedArtifactPaths.length}; received ${actualArtifactPaths.length}.`)
  const sourceManifests = sourceManifestNames.map((name) => {
    const manifestPath = assertInside(inputDir, name)
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { sourceCommit: string; tools: Record<string, string>; files: MediaManifestFile[] }
    if (manifest.sourceCommit !== sourceCommit) fail(`Generation manifest ${name} does not match source commit ${sourceCommit}.`)
    return { name, ...manifest }
  })
  const provenanceFiles = new Map(sourceManifests.flatMap((manifest) => manifest.files.map((file) => [file.path, file] as const)))
  if (provenanceFiles.size !== paths.length || paths.some((path) => !provenanceFiles.has(path))) fail('Generation manifests do not cover the exact requested PNG set.')
  const pngEntries: Array<{ path: string; source: string; before?: string; info: Awaited<ReturnType<typeof inspectPng>>; status: 'added' | 'changed' | 'unchanged' }> = []
  const mediaFiles: MediaManifestFile[] = []
  for (const path of paths) {
    const assetPath = path.replace(/^docs\/assets\//, '')
    const source = assertInside(inputDir, assetPath)
    if (!existsSync(source) || !lstatSync(source).isFile()) fail(`Expected generated artifact is missing: ${assetPath}`)
    const info = await inspectPng(source)
    const before = assertInside(root, path)
    const beforeExists = existsSync(before)
    const beforeHash = beforeExists ? sha256(before) : null
    const status = !beforeExists ? 'added' : beforeHash === info.sha256 ? 'unchanged' : 'changed'
    const provenance = provenanceFiles.get(path)!
    if (provenance.result !== 'success' || provenance.sha256 !== info.sha256 || provenance.bytes !== info.bytes || provenance.sizeAfterOptimization !== info.bytes || !Number.isSafeInteger(provenance.sizeBeforeOptimization) || (provenance.sizeBeforeOptimization ?? 0) < info.bytes || provenance.status !== status) fail(`PNG optimizer provenance does not match the artifact: ${path}`)
    pngEntries.push({ path, source, before: beforeExists ? path : undefined, info, status })
    mediaFiles.push({ ...provenance, path, result: 'success', status, width: info.width, height: info.height, bytes: info.bytes, sha256: info.sha256, hasAlpha: info.hasAlpha })
  }
  const allPngs = pngEntries.map((entry) => entry.source)
  validatePublicMetadata(allPngs)
  rmSyncSafe(packageDir)
  mkdirSync(packageDir, { recursive: true })
  for (const item of pngEntries) {
    const destination = assertInside(packageDir, item.path.replace(/^docs\/assets\//, ''))
    mkdirSync(dirname(destination), { recursive: true })
    cpSync(item.source, destination)
  }
  const reportDir = resolve(packageDir, 'comparison')
  await writeReport(root, pngEntries.map((item) => ({ path: item.path, source: relative(root, item.source), before: item.before, status: item.status })), reportDir)
  cpSync(resolve(reportDir, 'report.html'), resolve(packageDir, 'report.html'))
  const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { version: string }
  const manifest = createManifest({
    generatedAt: new Date().toISOString(), sourceCommit, appVersion: packageJson.version,
    kind: config.type, languages: languagesFor(config.type, config.language), scene: config.scene,
    tools: {
      bun: sourceManifests[0]?.tools.bun ?? Bun.version,
      playwright: sourceManifests[0]?.tools.playwright ?? JSON.parse(readFileSync(resolve(root, 'node_modules/@playwright/test/package.json'), 'utf8')).version,
      chromium: sourceManifests.find((manifest) => manifest.tools.chromium && manifest.tools.chromium !== 'not used')?.tools.chromium ?? 'not used',
      rustc: sourceManifests[0]?.tools.rustc ?? process.env.MEDIA_RUSTC_VERSION ?? 'unavailable',
      cargo: sourceManifests[0]?.tools.cargo ?? process.env.MEDIA_CARGO_VERSION ?? 'unavailable',
      oxipng: sourceManifests[0]?.tools.oxipng ?? 'unavailable',
      exiftool: sourceManifests[0]?.tools.exiftool ?? exiftoolVersion(),
    },
    files: mediaFiles,
  })
  writeFileSync(resolve(packageDir, 'manifest.json'), JSON.stringify(manifest, null, 2))
  const changed = mediaFiles.filter((file) => file.status === 'added' || file.status === 'changed')
  setOutput('changed', changed.length ? 'true' : 'false')
  setOutput('changed_count', String(changed.length))
  setOutput('success_count', String(mediaFiles.length))
  setOutput('failure_count', '0')
  setOutput('total_bytes', String(manifest.totalBytes))
  setOutput('file_list', JSON.stringify(paths))
  console.log(`Packaged ${mediaFiles.length} media files; ${changed.length} differ from main.`)
}

function rmSyncSafe(path: string) {
  if (existsSync(path) && lstatSync(path).isSymbolicLink()) fail(`Refusing to remove symlink: ${path}`)
  rmSync(path, { recursive: true, force: true })
}

async function verifyApproved() {
  const manifestPath = resolve(root, '.media-package/manifest.json')
  if (!existsSync(manifestPath)) fail('Artifact manifest is missing; regenerate the media artifact.')
  if (lstatSync(manifestPath).isSymbolicLink()) fail('Artifact manifest must not be a symbolic link.')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { sourceCommit: string; kind: MediaType; languages: string[]; scene: string; runResult: string; failureCount: number; files: MediaManifestFile[] }
  const config = inputConfig()
  const expected = expectedPaths(config.type, config.language, config.scene)
  if (manifest.sourceCommit !== (process.env.MEDIA_SOURCE_COMMIT ?? '')) fail('Artifact source commit does not match the approved run; regenerate the media.')
  const checkedOutCommit = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' })
  if (checkedOutCommit.status !== 0 || checkedOutCommit.stdout.trim() !== manifest.sourceCommit) fail('Artifact source commit does not match the checked out source.')
  if (manifest.kind !== config.type || manifest.scene !== config.scene || JSON.stringify(manifest.languages) !== JSON.stringify(languagesFor(config.type, config.language))) fail('Artifact generation configuration does not match this run.')
  if (manifest.runResult !== 'success' || manifest.failureCount !== 0) fail('Artifact manifest does not describe a fully successful generation.')
  if (!Array.isArray(manifest.files) || manifest.files.length !== expected.length) fail('Artifact file count does not match the validated request.')
  const actualFiles: string[] = []
  for (const entry of manifest.files) {
    if (!expected.includes(entry.path) || entry.result !== 'success' || !entry.sha256 || !/^[0-9a-f]{64}$/.test(entry.sha256)) fail(`Artifact contains an invalid or unapproved file: ${entry.path}`)
    const source = assertInside(resolve(root, '.media-package'), entry.path.replace(/^docs\/assets\//, ''))
    if (!existsSync(source) || !lstatSync(source).isFile()) fail(`Approved artifact file is missing: ${entry.path}`)
    const info = await inspectPng(source)
    if (info.sha256 !== entry.sha256 || info.bytes !== entry.bytes || info.width !== entry.width || info.height !== entry.height) fail(`Artifact hash or image metadata mismatch: ${entry.path}`)
    const baseline = assertInside(root, entry.path)
    const baselineHash = existsSync(baseline) ? sha256(baseline) : null
    const actualStatus = baselineHash === null ? 'added' : baselineHash === info.sha256 ? 'unchanged' : 'changed'
    if (entry.status !== actualStatus) fail(`Artifact change status does not match the base commit: ${entry.path}`)
    actualFiles.push(source)
  }
  const publicPngs: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name), stat = lstatSync(path)
      if (stat.isSymbolicLink()) fail(`Artifact contains a symbolic link: ${relative(root, path)}`)
      if (stat.isDirectory()) walk(path)
      else if (name.toLowerCase().endsWith('.png')) publicPngs.push(path)
      else fail(`Artifact contains a non-PNG file in a media directory: ${relative(root, path)}`)
    }
  }
  for (const area of ['screenshots', 'examples']) {
    const dir = resolve(root, '.media-package', area)
    if (existsSync(dir)) walk(dir)
  }
  if (publicPngs.length !== expected.length || actualFiles.some((file) => !publicPngs.includes(file))) fail('Artifact has missing or unlisted public PNG files.')
  validatePublicMetadata(actualFiles)
  setOutput('verified_count', String(actualFiles.length))
  console.log(`Verified ${actualFiles.length} approved files and SHA-256 values.`)
}

async function publishApproved() {
  await verifyApproved()
  const manifest = JSON.parse(readFileSync(resolve(root, '.media-package/manifest.json'), 'utf8')) as { files: MediaManifestFile[] }
  const paths = manifest.files.filter((entry) => entry.result === 'success' && (entry.status === 'added' || entry.status === 'changed')).map((entry) => entry.path)
  for (const path of paths) {
    if (!isAllowedGeneratedPath(path)) fail(`Refusing to publish a disallowed path: ${path}`)
    const source = assertInside(resolve(root, '.media-package'), path.replace(/^docs\/assets\//, ''))
    const target = assertInside(root, path)
    if (!existsSync(source)) fail(`Approved artifact is missing: ${path}`)
    mkdirSync(dirname(target), { recursive: true })
    cpSync(source, target)
  }
  const args = ['add', '--', ...paths]
  const result = spawnSync('git', args, { cwd: root, stdio: 'inherit' })
  if (result.status !== 0) fail('Could not stage the verified generated images.')
  const staged = spawnSync('git', ['diff', '--cached', '--name-only', '-z'], { cwd: root, encoding: 'buffer' })
  if (staged.status !== 0) fail('Could not verify the staged file list.')
  const stagedPaths = staged.stdout.toString().split('\0').filter(Boolean).sort()
  if (JSON.stringify(stagedPaths) !== JSON.stringify([...paths].sort())) fail('Staged changes include files outside the approved generated PNG set.')
  writeFileSync(resolve(root, '.media-package/changed-paths.json'), JSON.stringify(paths, null, 2))
}

function markdownImage(path: string, commit: string, repo: string) {
  return `https://raw.githubusercontent.com/${repo}/${commit}/${path}`
}
function compareRow(path: string, beforeSha: string, afterSha: string, repo: string, beforeExists: boolean) {
  const after = `![After](${markdownImage(path, afterSha, repo)})`
  return beforeExists ? `| Before | After |\n|---|---|\n| ![Before](${markdownImage(path, beforeSha, repo)}) | ${after} |` : `| After |\n|---|\n| ${after} |`
}
export function createPrBody(input: { repo: string; baseSha: string; resultSha: string; runUrl: string; runId: string; manifest: { kind: string; languages: string[]; scene: string; files: MediaManifestFile[] } }) {
  const changes = input.manifest.files.filter((file) => file.status === 'added' || file.status === 'changed')
  const hero = changes.find((file) => file.path.endsWith('/hero.png'))
  const screenshots = changes.filter((file) => file.path.includes('/screenshots/') && file !== hero)
  const examples = changes.filter((file) => file.path.includes('/examples/'))
  const screenshotGroup = (language: Language) => {
    const files = screenshots.filter((file) => file.path.includes(`/screenshots/${language}/`))
    if (!files.length) return ''
    return `<details><summary>${language === 'ja' ? 'Japanese' : 'English'} screenshots (${files.length})</summary>\n\n${files.map((file) => `#### ${file.path.split('/').at(-1)}\n\n${compareRow(file.path, input.baseSha, input.resultSha, input.repo, file.status === 'changed')}\n`).join('\n')}\n</details>`
  }
  const exampleGroup = examples.length ? `<details><summary>Export examples (${examples.length})</summary>\n\n${examples.map((file) => `#### ${file.path.split('/').at(-1)}\n\n${compareRow(file.path, input.baseSha, input.resultSha, input.repo, file.status === 'changed')}\n`).join('\n')}\n</details>` : 'No export examples changed.'
  const screenshotComparison = [screenshotGroup('ja'), screenshotGroup('en')].filter(Boolean).join('\n\n') || 'No screenshots changed.'
  const heroComparison = hero ? compareRow(hero.path, input.baseSha, input.resultSha, input.repo, hero.status === 'changed') : 'No hero image changed.'
  const runLink = `[Workflow run ${input.runId}](${input.runUrl})`
  return `## Summary\n\nRefresh ${changes.length} generated documentation media file(s).\n\n## Motivation\n\nKeep the published documentation visuals aligned with the current Lustra UI and production export renderer.\n\n## Generation Results\n\n- Requested target: ${input.manifest.kind}; language: ${input.manifest.languages.join(', ') || 'not applicable'}; scene: ${input.manifest.scene}.\n- Validated changes: ${changes.length} of ${input.manifest.files.length} requested files.\n- Source commit: \`${input.baseSha}\`.\n\n## Changes\n\n${changes.map((file) => `- \`${file.path}\` (${file.status}, ${file.width} × ${file.height}, ${file.bytes} bytes, SHA-256 \`${file.sha256}\`)`).join('\n')}\n\n## Screenshot Comparison\n\n### Hero\n\n${heroComparison}\n\n${screenshotComparison}\n\n## Exported Examples\n\n${exampleGroup}\n\n## Testing / Validation\n\n- Generation jobs completed for every requested target.\n- PNG signature, dimensions, SHA-256, metadata privacy, expected paths, and staged file allowlist verified after approval.\n- Existing required CI will run for this PR.\n\n## Known Issues\n\n- Native export examples run on macOS because Lustra's production renderer uses CoreGraphics, CoreText, and ImageIO. Screenshot generation and artifact validation run on Ubuntu 24.04.\n\n## Workflow Run\n\n${runLink}\n\nReview all generated media and the offline report in the workflow artifacts before merging.`
}

async function writePrBody() {
  const manifest = JSON.parse(readFileSync(resolve(root, '.media-package/manifest.json'), 'utf8'))
  const body = createPrBody({
    repo: process.env.GITHUB_REPOSITORY ?? '', baseSha: process.env.MEDIA_SOURCE_COMMIT ?? '',
    resultSha: process.env.MEDIA_RESULT_COMMIT ?? '', runUrl: process.env.MEDIA_RUN_URL ?? '',
    runId: process.env.GITHUB_RUN_ID ?? '', manifest,
  })
  writeFileSync(resolve(root, '.media-package/pr-body.md'), body)
}

async function main() {
  const command = process.argv[2]
  if (!command || command === '--help' || command === '-h') {
    console.log('Usage: bun scripts/media/workflow.ts <validate-config|export-generated|package|verify-approved|publish-approved|pr-body>')
    return
  }
  if (command === 'validate-config') return validateDispatch()
  if (command === 'export-generated') return exportGenerated()
  if (command === 'package') return packageArtifacts()
  if (command === 'verify-approved') return verifyApproved()
  if (command === 'publish-approved') return publishApproved()
  if (command === 'pr-body') return writePrBody()
  fail(`Unknown workflow helper command: ${command}`)
}

if (import.meta.main) main().catch((error) => { console.error(`media workflow: ${error instanceof Error ? error.stack ?? error.message : String(error)}`); process.exitCode = 1 })

export { expectedPaths, languagesFor, parseLanguage, parseMediaType, parseScene }
