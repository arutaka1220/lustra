import { expect, test, type Page } from '@playwright/test'
import { resolve } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { SCREEN_SCENES } from '../helpers/media'

const root = resolve(import.meta.dirname, '../../..')
const language = process.env.MEDIA_LANGUAGE === 'ja' ? 'ja' : 'en'
const requested = process.env.MEDIA_SCENE ?? 'all'
const names: Record<string, string> = { hero: 'jellyfish.jpg', 'frame-styles': 'jellyfish.jpg', 'ambient-gradient': 'aviation.jpg', 'edge-stretch': 'illumination.jpg', 'portrait-card': 'jellyfish.jpg', 'crop-and-rotate': 'alley.jpg', 'custom-color': 'illumination.jpg', metadata: 'aviation.jpg', import: 'jellyfish.jpg', review: 'jellyfish.jpg', export: 'jellyfish.jpg', 'metadata-corrections': 'jellyfish.jpg' }
const photos = ['aviation.jpg', 'jellyfish.jpg', 'alley.jpg', 'illumination.jpg']
const selected = requested === 'all' ? [...SCREEN_SCENES] : [requested]

async function start(page: Page, scene: string) {
  await page.addInitScript((lang) => {
    localStorage.clear()
    localStorage.setItem('lustra.language', lang)
    localStorage.setItem('lustra.png-webp-notice', 'seen')
  }, language)
  await page.goto('/')
  await expect(page.getByRole('heading').first()).toBeVisible()
  await page.getByRole('button', { name: language === 'ja' ? /写真を読み込む/ : /import photos/i }).click()
  const chosen = ['hero', 'import', 'review', 'export'].includes(scene) ? photos : [names[scene]!]
  await page.locator('input[type=file]').first().setInputFiles(chosen.map(name => resolve(root, 'scripts/media/fixtures', name)))
  await expect(page.getByRole('heading', { name: language === 'ja' ? /写真を選択/ : /choose your photos/i })).toBeVisible()
  await expect(page.locator('.candidate-card')).toHaveCount(chosen.length)
  if (scene === 'import') return
  await page.locator('.candidate-footer button').click()
  await expect(page.getByRole('region', { name: language === 'ja' ? /写真/ : /photos/i })).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('.framed-preview-surface')).toBeVisible({ timeout: 30_000 })
}

async function addDemoCameraCorrection(page: Page) {
  await page.locator('.app-toolbar__right button').last().click()
  await page.getByRole('button', { name: /metadata corrections|撮影情報の補正/i }).click()
  const cameraRules = page.locator('.correction-rules').filter({ has: page.getByRole('heading', { name: /camera information corrections|カメラ名の補正/i }) })
  if (await cameraRules.getByText('Nikon Z6 II').count() === 0) {
    await cameraRules.getByRole('button', { name: /add rule|ルールを追加/i }).click()
    await cameraRules.getByRole('textbox', { name: /find|検索する値/i }).fill('NIKON CORPORATION NIKON Z 6_2')
    await cameraRules.getByRole('textbox', { name: /replace with|置換後の値/i }).fill('Nikon Z6 II')
    await cameraRules.getByRole('button', { name: /save rule|ルールを保存/i }).click()
  }
  await expect(cameraRules.getByText('Nikon Z6 II')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('.preferences-dialog')).toBeHidden()
}

async function enableExportScreenForBrowserCapture(page: Page) {
  await page.evaluate(() => {
    const runtime = window as typeof window & {
      isTauri?: boolean
      __TAURI_INTERNALS__?: { invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown> }
    }
    runtime.isTauri = true
    runtime.__TAURI_INTERNALS__ = {
      invoke: async (command, args = {}) => {
        if (command === 'get_export_capabilities') {
          return { formats: ['jpeg', 'png', 'webp'], metadataFormats: ['jpeg', 'png', 'webp'], iccFormats: ['jpeg', 'png'] }
        }
        if (command === 'load_preferences' && args.key === 'export.settings') {
          return {
            format: 'jpeg', size: 1440, quality: 90, colorSpace: 'srgb',
            keepCamera: true, keepLens: true, keepExposure: true, keepDate: true,
            keepGps: false, keepSerial: false, applyMetadataCorrections: true,
            destination: '~/Pictures/Lustra',
          }
        }
        if (command === 'check_export_destination') return true
        if (command === 'load_preferences' || command === 'read_metadata_corrections' || command === 'save_sessions') return null
        throw new Error(`Unexpected Tauri command in media capture: ${command}`)
      },
    }
  })
}

async function capture(page: Page, scene: string) {
  const outputDirectory = resolve(process.env.MEDIA_OUTPUT_DIR ?? resolve(root, '.media-tmp/screenshots', language))
  const output = resolve(outputDirectory, `${scene}.png`)
  await mkdir(outputDirectory, { recursive: true })
  if (scene === 'import') {
    await expect(page.locator('.candidate-card')).toHaveCount(4)
    await page.screenshot({ path: output, animations: 'disabled', caret: 'hide' })
    return
  }
  const targetPhoto = scene === 'ambient-gradient' || scene === 'metadata' ? 'aviation.jpg' : scene === 'edge-stretch' || scene === 'custom-color' ? 'illumination.jpg' : scene === 'crop-and-rotate' ? 'alley.jpg' : 'jellyfish.jpg'
  const photoButton = page.locator('.filmstrip-item').filter({ hasText: targetPhoto })
  await expect(photoButton).toBeVisible()
  await photoButton.click()
  if (['hero', 'ambient-gradient', 'edge-stretch', 'portrait-card', 'custom-color', 'metadata', 'review'].includes(scene)) await addDemoCameraCorrection(page)
  if (scene === 'hero') {
    await page.getByRole('button', { name: /ambient gradient|アンビエントグラデーション/i }).click()
  }
  if (scene === 'frame-styles') {
    const styles = page.locator('.style-picker')
    await expect(styles.locator('button')).toHaveCount(9)
    await styles.screenshot({ path: output, animations: 'disabled' })
    return
  }
  if (scene === 'crop-and-rotate') {
    await page.locator('.preview-board').dblclick()
    await expect(page.locator('.crop-overlay')).toBeVisible()
    await page.getByRole('textbox', { name: /rotation|回転/i }).fill('2.5')
    await expect(page.locator('.crop-overlay')).toBeVisible()
    await expect(page.getByRole('textbox', { name: /rotation|回転/i })).toHaveValue('2.5')
  } else if (scene === 'portrait-card') {
    await page.getByRole('combobox', { name: /canvas layout|レイアウト/i }).click()
    await page.getByRole('option', { name: /portrait card|ポートレートカード/i }).click()
    await page.getByRole('combobox', { name: /canvas ratio|キャンバス比率/i }).click()
    await page.getByRole('option', { name: '4:5' }).click()
  } else if (scene === 'ambient-gradient' || scene === 'edge-stretch') {
    await page.getByRole('button', { name: scene === 'ambient-gradient' ? /ambient gradient|アンビエントグラデーション/i : /edge stretch/i }).click()
    const appearance = page.getByRole('button', { name: /appearance|外観/i })
    if (await appearance.getAttribute('aria-expanded') !== 'true') await appearance.click()
  } else if (scene === 'custom-color') {
    await page.locator('.style-picker .custom-color__tile').click()
    await page.getByRole('textbox', { name: 'HEX' }).fill('#B7A175')
    await expect(page.getByRole('textbox', { name: 'HEX' })).toHaveValue('#B7A175')
  } else if (scene === 'metadata-corrections') {
    await addDemoCameraCorrection(page)
    await page.locator('.app-toolbar__right button').last().click()
  } else if (scene === 'review') {
    const minimumSize = page.getByRole('slider', { name: /minimum size|最小サイズ/i })
    if (await minimumSize.count()) await minimumSize.fill('160')
    for (const name of photos) {
      const item = page.locator('.filmstrip-item').filter({ hasText: name })
      await item.click()
      const complete = page.locator('.preview-completion')
      if (await complete.getAttribute('aria-pressed') !== 'true') await complete.click()
    }
    await page.getByRole('button', { name: /review photos|写真をレビュー/i }).click()
    await expect(page.locator('.review-thumbnail')).toHaveCount(4)
  } else if (scene === 'export') {
    await page.getByRole('button', { name: /review photos|写真をレビュー/i }).click()
    await expect(page.locator('.review-thumbnail')).toHaveCount(4)
    await enableExportScreenForBrowserCapture(page)
    await page.getByRole('button', { name: /export all|すべてを書き出す/i }).click()
    await expect(page.getByRole('heading', { name: /export photos|写真を書き出す/i })).toBeVisible()
    await expect(page.getByText('~/Pictures/Lustra')).toBeVisible()
    await expect(page.getByText(/Your changes could not be saved|変更を保存できませんでした/)).toHaveCount(0)
  }
  await expect(page.locator('body')).not.toContainText(/Photo unavailable|プレビューを利用できません/)
  await page.evaluate(async () => { await document.fonts.ready; await Promise.all(Array.from(document.images, image => image.decode().catch(() => {}))) })
  await page.addStyleTag({ content: '.canvas-text--placeholder{display:none!important}' })
  await page.screenshot({ path: output, animations: 'disabled', caret: 'hide', fullPage: false })
}

for (const scene of selected) {
  test(`${language} media: ${scene}`, async ({ page }) => {
    await start(page, scene)
    await capture(page, scene)
  })
}
