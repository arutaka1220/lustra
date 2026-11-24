import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const appUrl = process.env.LUSTRA_E2E_FILE_MODE === '1' ? pathToFileURL(resolve('dist/index.html')).href : '/'

test('review opens a framed preview and can switch between images', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'createImageBitmap', {
      configurable: true,
      value: async () => { throw new Error('createImageBitmap resize is unavailable') },
    })
  })
  await page.goto(appUrl)
  await page.getByRole('button', { name: /import photos/i }).click()
  await page.locator('input[type=file]').first().setInputFiles([resolve('src-tauri/tests/fixtures/test_exif_01.jpg'), resolve('src-tauri/tests/fixtures/test_exif_02.png')])
  await page.getByRole('button', { name: /got it/i }).click()
  await page.getByRole('button', { name: /import 2 photos/i }).click()
  await expect(page.getByRole('region', { name: /photos/i })).toBeVisible({ timeout: 10_000 })
  await page.getByRole('button', { name: /done & next/i }).click()
  await page.getByRole('button', { name: /done & next/i }).click()
  await expect(page.getByRole('heading', { name: /take one last look/i })).toBeVisible()

  const first = page.getByRole('button', { name: /preview test_exif_01\.jpg/i })
  const second = page.getByRole('button', { name: /preview test_exif_02\.png/i })
  await expect(page.getByRole('slider', { name: /minimum size/i })).toBeDisabled()
  for (const card of [first, second]) {
    await expect(card.locator('.review-thumbnail__canvas')).toBeVisible({ timeout: 10_000 })
    const imageBox = await card.locator('.review-thumbnail__board').boundingBox()
    const cardBox = await card.locator('..').boundingBox()
    expect(imageBox?.height).toBeGreaterThan(300)
    expect(Math.abs((imageBox?.x ?? 0) - (cardBox?.x ?? 0))).toBeLessThanOrEqual(1)
    expect(Math.abs((imageBox?.y ?? 0) - (cardBox?.y ?? 0))).toBeLessThanOrEqual(1)
    expect(Math.abs((imageBox?.width ?? 0) - (cardBox?.width ?? 0))).toBeLessThanOrEqual(1)
    expect(Math.abs((imageBox?.height ?? 0) - (cardBox?.height ?? 0))).toBeLessThanOrEqual(1)
    const check = card.locator('.review-complete-mark').boundingBox()
    const markBox = await check
    expect(markBox).not.toBeNull()
    expect(markBox!.x + markBox!.width).toBeLessThanOrEqual(cardBox!.x + cardBox!.width + 1)
    expect(markBox!.y).toBeGreaterThanOrEqual(cardBox!.y - 1)
    await card.hover()
    const infoBox = await card.locator('..').locator('.review-card__info').boundingBox()
    expect(infoBox).not.toBeNull()
    expect(infoBox!.x).toBeGreaterThanOrEqual(cardBox!.x - 1)
    expect(infoBox!.x + infoBox!.width).toBeLessThanOrEqual(cardBox!.x + cardBox!.width + 1)
  }
  await page.setViewportSize({ width: 900, height: 640 })
  const narrowCard = await first.boundingBox()
  expect(narrowCard?.x).toBeGreaterThanOrEqual(0)
  expect((narrowCard?.x ?? 0) + (narrowCard?.width ?? 0)).toBeLessThanOrEqual(900)
  const dialog = page.getByRole('dialog').filter({ has: page.locator('.review-preview-stage') })
  for (const card of [first, second, first]) {
    await card.click()
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('.review-preview-stage canvas').first()).toBeVisible({ timeout: 10_000 })
    await page.getByRole('button', { name: /close/i }).click()
    await expect(dialog).toBeHidden()
  }
})

test('review minimum size adjusts dense rows and stays available while the gallery scrolls', async ({ page }, testInfo) => {
  await page.goto(appUrl)
  await page.getByRole('button', { name: /import photos/i }).click()
  const fixture = readFileSync(resolve('src-tauri/tests/fixtures/test_exif_01.jpg'))
  await page.locator('input[type=file]').first().setInputFiles(Array.from({ length: 10 }, (_, index) => ({ name: `review-${index}.jpg`, mimeType: 'image/jpeg', buffer: fixture })))
  await page.getByRole('button', { name: /import 10 photos/i }).click()
  await expect(page.getByRole('region', { name: /photos/i })).toBeVisible({ timeout: 10_000 })
  for (let index = 0; index < 10; index++) await page.getByRole('button', { name: /done & next/i }).click()
  await expect(page.getByRole('heading', { name: /take one last look/i })).toBeVisible()

  const slider = page.getByRole('slider', { name: /minimum size/i })
  await expect(slider).toBeEnabled()
  await expect(slider).toHaveValue('240')
  const rowCount = async () => new Set(await page.locator('.review-card').evaluateAll((cards) => cards.map((card) => Math.round(card.getBoundingClientRect().top)))).size
  const defaultRows = await rowCount()
  await slider.fill('160')
  await expect(slider).toHaveValue('160')
  await expect.poll(rowCount).toBeLessThan(defaultRows)
  await slider.fill('400')
  await expect(slider).toHaveValue('400')
  await expect.poll(rowCount).toBeGreaterThan(defaultRows)
  const grid = page.locator('.review-grid')
  await expect.poll(async () => grid.locator('.review-card').count()).toBe(10)
  const geometry = await grid.evaluate((element) => {
    const canvas = element.querySelector('.review-grid__canvas')!.getBoundingClientRect()
    const cards = [...element.querySelectorAll('.review-card')].map((card) => card.getBoundingClientRect())
    return { clientWidth: element.clientWidth, scrollWidth: element.scrollWidth, canvasLeft: canvas.left, canvasRight: canvas.right, cards: cards.map(({ x, y, width }) => ({ x, y, width })) }
  })
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1)
  const rows = new Map<number, typeof geometry.cards>()
  for (const card of geometry.cards) {
    const top = Math.round(card.y)
    rows.set(top, [...(rows.get(top) ?? []), card])
  }
  for (const cards of rows.values()) {
    const left = Math.min(...cards.map((card) => card.x))
    const right = Math.max(...cards.map((card) => card.x + card.width))
    expect(Math.abs(left - geometry.canvasLeft)).toBeLessThanOrEqual(1)
    expect(Math.abs(right - geometry.canvasRight)).toBeLessThanOrEqual(1)
  }
  await expect.poll(async () => page.evaluate(() => localStorage.getItem('lustra.preferences.review.minimumPhotoSize'))).toBe('400')
  await page.screenshot({ path: testInfo.outputPath('review-gallery-min-size.png') })

  const heading = page.locator('.review-heading')
  const headerTop = (await heading.boundingBox())!.y
  const gallery = page.locator('.review-grid')
  await gallery.evaluate((element) => { element.scrollTop = element.scrollHeight })
  await expect.poll(async () => gallery.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
  expect((await heading.boundingBox())!.y).toBeCloseTo(headerTop, 0)
  await expect(page.getByRole('button', { name: /export all/i })).toBeVisible()
  await expect(slider).toBeVisible()

  await page.getByRole('button', { name: /back to editing/i }).click()
  await page.getByRole('button', { name: /review photos/i }).click()
  const restoredSlider = page.getByRole('slider', { name: /minimum size/i })
  await expect(restoredSlider).toHaveValue('400')

  await page.getByRole('button', { name: /reset minimum size/i }).click()
  await expect(restoredSlider).toHaveValue('240')
})
