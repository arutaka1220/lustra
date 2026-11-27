#!/usr/bin/env bun
import { spawnSync } from 'node:child_process'
import { closeSync, copyFileSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, resolve, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { createManifest, EXAMPLE_FILES, inspectPng, wrapScreenshotSvg, writeReport, type MediaManifestFile } from './helpers/media'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const scenes = ['hero', 'frame-styles', 'ambient-gradient', 'edge-stretch', 'portrait-card', 'crop-and-rotate', 'custom-color', 'metadata', 'import', 'review', 'export', 'metadata-corrections'] as const
const allowedExifTags = new Set([
  'ExifTool:ExifToolVersion', 'File:BitsPerSample', 'File:ColorComponents', 'File:EncodingProcess', 'File:ExifByteOrder', 'File:FileType', 'File:FileTypeExtension', 'File:ImageHeight', 'File:ImageWidth', 'File:MIMEType', 'File:YCbCrSubSampling',
  'IFD0:Make', 'IFD0:Model', 'IFD0:ModifyDate', 'IFD0:YCbCrPositioning',
  'ExifIFD:ColorSpace', 'ExifIFD:ComponentsConfiguration', 'ExifIFD:CreateDate', 'ExifIFD:DateTimeOriginal', 'ExifIFD:ExifImageHeight', 'ExifIFD:ExifImageWidth', 'ExifIFD:ExifVersion', 'ExifIFD:ExposureTime', 'ExifIFD:FNumber', 'ExifIFD:FocalLength', 'ExifIFD:ISO', 'ExifIFD:LensMake', 'ExifIFD:LensModel', 'ExifIFD:OffsetTime', 'ExifIFD:OffsetTimeDigitized', 'ExifIFD:OffsetTimeOriginal',
  'PNG:BitDepth', 'PNG:ColorType', 'PNG:Compression', 'PNG:CreateDate', 'PNG:Filter', 'PNG:ImageHeight', 'PNG:ImageWidth', 'PNG:Interlace', 'PNG:Model', 'PNG:ModifyDate', 'PNG:SRGBRendering',
  'Composite:Aperture', 'Composite:FocalLength35efl', 'Composite:ImageSize', 'Composite:LensID', 'Composite:LightValue', 'Composite:Megapixels', 'Composite:ShutterSpeed', 'Composite:SubSecCreateDate', 'Composite:SubSecDateTimeOriginal', 'Composite:SubSecModifyDate',
])
const dummyCaptureDates = new Set(['2025:04:12 14:15:00', '2025:05:18 09:30:00', '2025:08:23 19:45:00', '2025:10:05 18:20:00'])
const exifDateTags = new Set(['ExifIFD:CreateDate', 'ExifIFD:DateTimeOriginal', 'IFD0:ModifyDate', 'PNG:CreateDate', 'PNG:ModifyDate', 'Composite:SubSecCreateDate', 'Composite:SubSecDateTimeOriginal', 'Composite:SubSecModifyDate'])
type Scene = typeof scenes[number]
type Language = 'ja' | 'en'
type Kind = 'all' | 'screenshots' | 'examples'

function usage(): never {
  console.log(`Documentation Media Pipeline\n\nUsage:\n  bun run media [all|screenshots|examples] [--language both|ja|en] [--scene all|${scenes.join('|')}]\n  bun run media:screenshots:ja -- --scene hero\n\nExamples require a native macOS Lustra export runtime. Screenshots require the approved fixtures in scripts/media/fixtures/.`)
  process.exit(0)
}

function parseArgs(args: string[]) {
  let kind: Kind = 'all'
  let language = 'both'
  let scene = 'all'
  let selectedKind = false
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    if (arg === '--help' || arg === '-h') usage()
    if (!selectedKind && ['all', 'screenshots', 'examples'].includes(arg)) { kind = arg as Kind; selectedKind = true; continue }
    if (arg === '--language') { language = args[++i] ?? ''; continue }
    if (arg === '--scene') { scene = args[++i] ?? ''; continue }
    throw new Error(`Unknown argument: ${arg}`)
  }
  if (!['both', 'ja', 'en'].includes(language)) throw new Error(`Unsupported language: ${language}`)
  if (scene !== 'all' && !scenes.includes(scene as Scene)) throw new Error(`Unknown scene: ${scene}`)
  if (kind === 'examples' && scene !== 'all') throw new Error('--scene cannot be used with examples.')
  return { kind, languages: language === 'both' ? ['ja', 'en'] as Language[] : [language as Language], scene: scene as 'all' | Scene }
}

function sha256(path: string) { return createHash('sha256').update(readFileSync(path)).digest('hex') }
function safeOutputPath(path: string) {
  const rel = relative(root, resolve(root, path))
  if (rel.startsWith(`..${sep}`) || rel === '..' || resolve(root, path) === root) throw new Error(`Output path escapes repository: ${path}`)
  let cursor = root
  for (const segment of rel.split(sep).slice(0, -1)) {
    cursor = resolve(cursor, segment)
    if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink()) throw new Error(`Output path traverses a symlink: ${path}`)
  }
  if (existsSync(resolve(root, path)) && lstatSync(resolve(root, path)).isSymbolicLink()) throw new Error(`Output path is a symlink: ${path}`)
  return resolve(root, path)
}

function selectedOutputs(config: ReturnType<typeof parseArgs>, temp: string) {
  const outputs: Array<{ staged: string; target: string; relative: string }> = []
  if (config.kind !== 'examples') for (const language of config.languages) for (const scene of config.scene === 'all' ? scenes : [config.scene]) {
    const target = safeOutputPath(`docs/assets/screenshots/${language}/${scene}.png`)
    outputs.push({ staged: resolve(temp, 'screenshots', language, `${scene}.png`), target, relative: relative(root, target) })
  }
  if (config.kind !== 'screenshots') for (const file of EXAMPLE_FILES) {
    const target = safeOutputPath(`docs/assets/examples/${file}`)
    outputs.push({ staged: resolve(temp, 'examples', file), target, relative: relative(root, target) })
  }
  return outputs
}

function safeErrorMessage(error: unknown) {
  return (error instanceof Error ? error.message : String(error))
    .replaceAll(root, '<repository>')
    .replace(/\/Users\/[^/\s]+/g, '<user-home>')
    .replace(/\/private\/var\/folders\/[^/\s]+/g, '<temporary-directory>')
}

function toolVersion(command: string, args: string[]) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8' })
  if (result.error || result.status !== 0) return 'unavailable'
  return result.stdout.trim().split('\n')[0] || 'unavailable'
}

function validatePublicMetadata(paths: string[]) {
  const result = spawnSync('exiftool', ['-json', '-a', '-G1', '-s', '-all:all', ...paths], { cwd: root, encoding: 'utf8' })
  if (result.error || result.status !== 0) throw new Error('ExifTool is required to audit public media metadata.')
  const files = JSON.parse(result.stdout) as Array<Record<string, unknown>>
  const unsafe = files.flatMap((file) => Object.entries(file).flatMap(([tag, value]) => {
    if (tag === 'SourceFile' || tag.startsWith('System:')) return []
    if (!allowedExifTags.has(tag)) return [tag]
    if (exifDateTags.has(tag) && !dummyCaptureDates.has(String(value).replace(/\+09:00$/, ''))) return [`${tag} (non-synthetic date)`]
    if ((tag === 'IFD0:Model' || tag === 'PNG:Model') && !['NIKON Z 6_2', 'Nikon Z6 II'].includes(String(value))) return [`${tag} (unexpected camera model)`]
    return []
  }))
  if (unsafe.length) throw new Error(`Unapproved metadata found in media: ${[...new Set(unsafe)].join(', ')}`)
}

async function writeFailureReport(config: ReturnType<typeof parseArgs>, outputs: Array<{ staged: string; relative: string }>, error: unknown) {
  const errors: Array<{ path?: string; message: string }> = []
  const files: MediaManifestFile[] = []
  const reportFiles: Array<{ path: string; source: string }> = []
  for (const output of outputs) {
    try {
      if (!existsSync(output.staged)) throw new Error('Expected image was not generated.')
      const info = await inspectPng(output.staged)
      const target = safeOutputPath(output.relative)
      const status = existsSync(target) ? (sha256(target) === info.sha256 ? 'unchanged' : 'changed') : 'added'
      files.push({ path: output.relative, result: 'success', status, width: info.width, height: info.height, bytes: info.bytes, sha256: info.sha256, hasAlpha: info.hasAlpha })
      reportFiles.push({ path: output.relative, source: relative(root, output.staged), status })
    } catch (fileError) {
      const message = safeErrorMessage(fileError)
      files.push({ path: output.relative, result: 'failed', status: 'failed', error: message })
      errors.push({ path: output.relative, message })
    }
  }
  const message = safeErrorMessage(error)
  if (!errors.some((entry) => entry.message === message)) errors.push({ message })
  const reportDir = safeOutputPath('.media-tmp/failure-report')
  rmSync(reportDir, { recursive: true, force: true })
  mkdirSync(reportDir, { recursive: true })
  const fileFailureCount = files.filter((file) => file.result === 'failed').length
  await writeReport(root, reportFiles, reportDir, { failureCount: fileFailureCount || 1, errors })
  const version = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version
  const manifest = createManifest({
    generatedAt: new Date().toISOString(),
    sourceCommit: Bun.spawnSync(['git', 'rev-parse', 'HEAD'], { cwd: root }).stdout.toString().trim(),
    appVersion: version,
    kind: config.kind,
    languages: config.languages,
    scene: config.scene,
    tools: { bun: Bun.version, playwright: JSON.parse(readFileSync(resolve(root, 'node_modules/@playwright/test/package.json'), 'utf8')).version, chromium: toolVersion('bunx', ['playwright', '--version']), oxipng: '10.2.1', rustc: toolVersion('rustc', ['--version']), cargo: toolVersion('cargo', ['--version']), exiftool: toolVersion('exiftool', ['-ver']) },
    files,
    errors: errors.map((entry) => entry.message),
  })
  await Bun.write(resolve(reportDir, 'manifest.json'), JSON.stringify(manifest, null, 2))
  const latestReport = safeOutputPath('.media-tmp/latest-report')
  rmSync(latestReport, { recursive: true, force: true })
  renameSync(reportDir, latestReport)
}

async function main() {
  const config = parseArgs(process.argv.slice(2))
  const temp = safeOutputPath('.media-tmp/run')
  mkdirSync(resolve(root, '.media-tmp'), { recursive: true })
  const lockPath = resolve(root, '.media-tmp/pipeline.lock')
  try {
    const lockFd = openSync(lockPath, 'wx', 0o600)
    try { writeSync(lockFd, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })) } finally { closeSync(lockFd) }
  } catch { throw new Error('Another Documentation Media Pipeline run is active, or .media-tmp/pipeline.lock needs manual removal after a crashed run.') }
  let outputs: ReturnType<typeof selectedOutputs> = []
  let chromiumVersion = 'not used'
  let stage = 'prepare output'
  try {
    rmSync(temp, { recursive: true, force: true }); mkdirSync(temp, { recursive: true })
    outputs = selectedOutputs(config, temp)
    stage = 'check approved fixtures and metadata'
    const requiredFixtures = config.kind === 'examples' ? ['jellyfish.jpg'] : ['aviation.jpg', 'jellyfish.jpg', 'alley.jpg', 'illumination.jpg']
    const missing = requiredFixtures.filter((name) => !existsSync(resolve(root, 'scripts/media/fixtures', name)))
    if (missing.length) throw new Error(`Missing approved fixtures: ${missing.join(', ')}. Add them to scripts/media/fixtures/.`)
    validatePublicMetadata(requiredFixtures.map((file) => resolve(root, 'scripts/media/fixtures', file)))
    if (config.kind !== 'examples') {
      for (const language of config.languages) {
        stage = `capture ${language} screenshots`
        const outputDir = resolve(temp, 'screenshots', language)
        const env = { ...process.env, MEDIA_LANGUAGE: language, MEDIA_SCENE: config.scene, MEDIA_OUTPUT_DIR: outputDir }
        const result = spawnSync('bunx', ['playwright', 'test', '--config=scripts/media/playwright.config.ts'], { cwd: root, env, stdio: 'inherit' })
        if (result.status !== 0) throw new Error(`Screenshot generation failed for ${language}.`)
      }
      const browser = await chromium.launch()
      chromiumVersion = browser.version()
      stage = 'decorate and validate screenshot captures'
      try {
        for (const language of config.languages) for (const scene of config.scene === 'all' ? scenes : [config.scene]) {
          const path = resolve(temp, 'screenshots', language, `${scene}.png`)
          if (!existsSync(path)) throw new Error(`Expected screenshot was not created: ${scene} (${language}).`)
          if (scene !== 'frame-styles') {
            const data = `data:image/png;base64,${readFileSync(path).toString('base64')}`
            const metadata = await inspectPng(path)
            const page = await browser.newPage({ viewport: { width: metadata.width + 128, height: metadata.height + 184 }, deviceScaleFactor: 1 })
            await page.setContent(wrapScreenshotSvg(data, metadata.width, metadata.height))
            const decorated = await page.screenshot({ omitBackground: true, animations: 'disabled' })
            await Bun.write(path, decorated)
            await page.close()
          }
          await inspectPng(path)
        }
      } finally { await browser.close() }
    }
    if (config.kind !== 'screenshots') {
      stage = 'render native export examples'
      if (process.platform !== 'darwin') throw new Error('Example generation uses Lustra native macOS image export and must run on macOS.')
      const input = resolve(root, 'scripts/media/fixtures/jellyfish.jpg')
      const output = resolve(temp, 'examples')
      mkdirSync(output, { recursive: true })
      const result = spawnSync('cargo', ['run', '--manifest-path', 'src-tauri/Cargo.toml', '--bin', 'documentation-media-examples', '--', input, output], { cwd: root, stdio: 'inherit' })
      if (result.status !== 0) throw new Error('Rust native export example generation failed.')
      const metadataResult = spawnSync('exiftool', ['-overwrite_original', '-TagsFromFile', input, '-LensModel', '-FocalLength', '-FNumber', '-ExposureTime', '-ISO', '-DateTimeOriginal', '-CreateDate', '-ModifyDate', '-OffsetTimeOriginal', '-OffsetTimeDigitized', '-OffsetTime', '-Model=Nikon Z6 II', ...EXAMPLE_FILES.map(file => resolve(output, file))], { cwd: root, stdio: 'inherit' })
      if (metadataResult.status !== 0) throw new Error('Could not attach the approved demo camera metadata to native examples.')
      for (const file of EXAMPLE_FILES) {
        if (!existsSync(resolve(output, file))) throw new Error(`Native renderer did not create ${file}.`)
        await inspectPng(resolve(output, file))
      }
    }
    const generatedPngs = outputs.map((item) => item.staged)
    stage = 'lossless PNG optimization and pixel validation'
    const optimizationReport = resolve(temp, 'optimization-results.json')
    const optimization = spawnSync('cargo', ['run', '--quiet', '--manifest-path', 'src-tauri/Cargo.toml', '--features', 'documentation-media', '--bin', 'documentation-media-optimize', '--', '--report-json', optimizationReport, ...generatedPngs], { cwd: root, stdio: 'inherit' })
    if (optimization.error || optimization.status !== 0 || !existsSync(optimizationReport)) throw new Error(`Lossless PNG optimization failed: ${optimization.error?.message || 'optimizer did not produce a report'}`)
    const optimizationResults = JSON.parse(readFileSync(optimizationReport, 'utf8')) as Array<{ index: number; before_bytes: number; after_bytes: number; width: number; height: number; has_alpha: boolean }>
    if (optimizationResults.length !== generatedPngs.length || optimizationResults.some((result, index) => result.index !== index)) throw new Error('PNG optimizer returned an incomplete or invalid result list.')
    const invalidImages = optimizationResults.flatMap((result, index) => {
      const isDecoratedScreenshot = generatedPngs[index]!.includes('/screenshots/') && !generatedPngs[index]!.endsWith('/frame-styles.png')
      return isDecoratedScreenshot && !result.has_alpha ? [generatedPngs[index]!] : []
    })
    if (invalidImages.length) throw new Error(`Decorated screenshots lost their transparent channel: ${invalidImages.join(', ')}`)
    const publish = outputs
    const stagedEntries = await Promise.all(publish.map(async (item, index) => {
      const info = await inspectPng(item.staged)
      const optimization = optimizationResults[index]!
      if (info.width !== optimization.width || info.height !== optimization.height || info.hasAlpha !== optimization.has_alpha) throw new Error(`Image properties changed unexpectedly during optimization: ${item.relative}`)
      return { item, info, optimization }
    }))
    const backupDir = resolve(temp, 'backup'); mkdirSync(backupDir, { recursive: true })
    const trackedBefore = new Map<string, string>()
    for (const item of publish) {
      if (existsSync(item.target)) {
        if (lstatSync(item.target).isSymbolicLink()) throw new Error(`Refusing to back up a symlinked asset: ${item.relative}`)
        const saved = resolve(backupDir, item.relative.replaceAll('/', '_'))
        copyFileSync(item.target, saved)
        trackedBefore.set(item.relative, relative(root, saved))
      }
    }
    stage = 'metadata audit, manifest, and HTML report generation'
    const manifest = createManifest({ generatedAt: new Date().toISOString(), sourceCommit: Bun.spawnSync(['git', 'rev-parse', 'HEAD'], { cwd: root }).stdout.toString().trim(), appVersion: JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version, kind: config.kind, languages: config.languages, scene: config.scene, tools: { bun: Bun.version, playwright: JSON.parse(readFileSync(resolve(root, 'node_modules/@playwright/test/package.json'), 'utf8')).version, chromium: chromiumVersion, oxipng: '10.2.1', rustc: toolVersion('rustc', ['--version']), cargo: toolVersion('cargo', ['--version']), exiftool: toolVersion('exiftool', ['-ver']) }, files: stagedEntries.map(({ item, info, optimization }) => { const old = trackedBefore.get(item.relative); const status = !old ? 'added' : sha256(resolve(root, old)) === info.sha256 ? 'unchanged' : 'changed'; return { path: item.relative, result: 'success', ...info, hasAlpha: optimization.has_alpha, sizeBeforeOptimization: optimization.before_bytes, sizeAfterOptimization: optimization.after_bytes, optimizationBytesSaved: optimization.before_bytes - optimization.after_bytes, status } }) })
    const reportDir = resolve(temp, 'report'); mkdirSync(reportDir, { recursive: true })
    await writeReport(root, stagedEntries.map(({ item, info, optimization }) => {
      const before = trackedBefore.get(item.relative)
      const status = !before ? 'added' : sha256(resolve(root, before)) === info.sha256 ? 'unchanged' : 'changed'
      return { path: item.relative, source: relative(root, item.staged), before, status, sizeBeforeOptimization: optimization.before_bytes, sizeAfterOptimization: optimization.after_bytes }
    }), reportDir)
    await Bun.write(resolve(reportDir, 'manifest.json'), JSON.stringify(manifest, null, 2))
    const metadataPaths = publish.map(({ staged }) => staged)
    validatePublicMetadata(metadataPaths)
    const published: typeof publish = []
    stage = 'publish validated files atomically'
    try {
      for (const item of publish) {
        mkdirSync(dirname(item.target), { recursive: true })
        const tempTarget = `${item.target}.media-tmp`
        if (existsSync(tempTarget) && lstatSync(tempTarget).isSymbolicLink()) throw new Error(`Refusing to write through a symlink: ${relative(root, tempTarget)}`)
        copyFileSync(item.staged, tempTarget)
        renameSync(tempTarget, item.target)
        published.push(item)
      }
      const savedReport = safeOutputPath('.media-tmp/latest-report')
      rmSync(savedReport, { recursive: true, force: true })
      renameSync(reportDir, savedReport)
    } catch (error) {
      for (const item of published.reverse()) {
        const backup = resolve(backupDir, item.relative.replaceAll('/', '_'))
        if (existsSync(backup)) copyFileSync(backup, item.target); else rmSync(item.target, { force: true })
      }
      for (const item of publish) rmSync(`${item.target}.media-tmp`, { force: true })
      throw error
    }
    console.log(`Published ${publish.length} validated media files.`)
  } catch (error) {
    const contextualError = new Error(`${stage}: ${safeErrorMessage(error)}`, { cause: error })
    try { await writeFailureReport(config, outputs, contextualError) } catch (reportError) { console.error(`media: could not save failure report: ${safeErrorMessage(reportError)}`) }
    throw contextualError
  } finally {
    rmSync(temp, { recursive: true, force: true })
    rmSync(lockPath, { force: true })
  }
}

if (import.meta.main) main().catch((error) => { console.error(`media: ${error instanceof Error ? error.stack ?? error.message : String(error)}`); process.exitCode = 1 })

export { parseArgs, safeOutputPath, validatePublicMetadata }
