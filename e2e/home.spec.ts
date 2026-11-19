import { expect, test } from '@playwright/test'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const appUrl = process.env.LUSTRA_E2E_FILE_MODE === '1'
  ? pathToFileURL(resolve('dist/index.html')).href
  : '/'

test('home screen loads and offers photo import', async ({ page }) => {
  await page.goto(appUrl)
  await expect(page.getByRole('heading').first()).toBeVisible()
  await expect(page.getByRole('button', { name: /import photos/i })).toBeVisible()
})

test('Home import creates a fresh photo import session', async ({ page }) => {
  await page.goto(appUrl)
  await page.getByRole('button', { name: /import photos/i }).click()
  await page.locator('input[type=file]').first().setInputFiles([resolve('test-data/DSC_8575.jpg'), resolve('test-data/DSC_8575.png')])
  await page.getByRole('button', { name: /got it/i }).click()
  await expect(page.getByRole('heading', { name: /choose your photos/i })).toBeVisible()
  await expect(page.getByText('DSC_8575.jpg')).toBeVisible()
  await expect(page.getByText('DSC_8575.png')).toBeVisible()
  await page.getByRole('button', { name: /import 2 photos/i }).click()
  await expect(page.getByRole('region', { name: /photos/i })).toBeVisible({ timeout: 10_000 })
  await expect(page.getByRole('button', { name: /all photos/i })).toBeVisible()
  await expect(page.getByRole('img', { name: 'DSC_8575.jpg' })).toBeVisible()
  await page.getByRole('button', { name: /custom/i }).click()
  await page.getByRole('button', { name: /choose custom frame color/i }).click()
  const picker = page.getByRole('dialog', { name: 'Frame Color' })
  await picker.getByRole('textbox', { name: 'HEX' }).fill('#123ABC')
  await expect(page.getByRole('button', { name: /choose custom frame color/i })).toContainText('#123ABC')
  await page.getByRole('button', { name: /save current color/i }).click()
  await expect(page.getByRole('region', { name: 'My Palette 1 / 16' })).toBeVisible()
  await page.locator('.custom-color__popover button[aria-label="Close color picker"]').click()
  await page.getByRole('button', { name: /link left & right/i }).click()
  await expect(page.getByRole('button', { name: /link left & right/i })).toHaveAttribute('aria-pressed', 'false')
  await page.getByRole('button', { name: /hide filmstrip/i }).click()
  await expect(page.getByRole('button', { name: /show filmstrip/i })).toBeVisible()
  await page.getByRole('button', { name: /show filmstrip/i }).click()
  const switchStarted = await page.evaluate(() => performance.now())
  await page.getByRole('button', { name: /next photo/i }).click()
  await expect(page.getByRole('img', { name: 'DSC_8575.png' })).toBeVisible()
  const switchElapsed = await page.evaluate(started => performance.now() - started, switchStarted)
  console.info(`[perf] next-photo switch to preloaded fixture: ${switchElapsed.toFixed(1)} ms`)
})
