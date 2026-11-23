import { expect, test } from '@playwright/test'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const appUrl = process.env.LUSTRA_E2E_FILE_MODE === '1' ? pathToFileURL(resolve('dist/index.html')).href : '/'

test('Ambient Gradient is selectable and its controls update while the photo stays visible', async ({ page }) => {
  await page.goto(appUrl)
  await page.getByRole('button', { name: /import photos/i }).click()
  await page.locator('input[type=file]').first().setInputFiles([resolve('src-tauri/tests/fixtures/test_exif_01.jpg')])
  await page.getByRole('button', { name: /import 1 photo/i }).click()
  await expect(page.getByRole('region', { name: /photos/i })).toBeVisible({ timeout: 10_000 })
  await page.getByRole('button', { name: /ambient gradient/i }).click()
  await page.getByRole('button', { name: /appearance/i }).click()
  await expect(page.getByRole('img', { name: 'test_exif_01.jpg' })).toBeVisible()
  await expect(page.getByRole('slider', { name: 'Intensity' })).toBeVisible()
  await expect(page.getByRole('slider', { name: 'Softness' })).toBeVisible()
  await expect(page.getByRole('slider', { name: 'Brightness' })).toBeVisible()
  await expect(page.getByLabel('Color Source')).toBeVisible()
  await page.getByLabel('Color Source').selectOption('edges')
  await expect(page.getByLabel('Color Source')).toHaveValue('edges')
  const preview = page.locator('.framed-preview-surface')
  const defaultPreview = await preview.screenshot()
  await page.getByRole('spinbutton', { name: 'Intensity' }).fill('42')
  await page.getByRole('spinbutton', { name: 'Intensity' }).press('Enter')
  const adjustedPreview = await preview.screenshot()
  expect(Buffer.compare(defaultPreview, adjustedPreview)).not.toBe(0)
  await page.getByRole('button', { name: 'Black', exact: true }).click()
  await page.getByRole('button', { name: /ambient gradient/i }).click()
  await expect(page.getByRole('spinbutton', { name: 'Intensity' })).toHaveValue('42')
})
