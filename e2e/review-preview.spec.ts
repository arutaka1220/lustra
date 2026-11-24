import { expect, test } from '@playwright/test'
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
  for (const card of [first, second]) {
    await expect(card.locator('.review-thumbnail__canvas')).toBeVisible({ timeout: 10_000 })
    const imageBox = await card.locator('.review-thumbnail__board').boundingBox()
    expect(imageBox?.height).toBeGreaterThan(300)
  }
  const dialog = page.getByRole('dialog').filter({ has: page.locator('.review-preview-stage') })
  for (const card of [first, second, first]) {
    await card.click()
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('.review-preview-stage canvas').first()).toBeVisible({ timeout: 10_000 })
    await page.getByRole('button', { name: /close/i }).click()
    await expect(dialog).toBeHidden()
  }
})
