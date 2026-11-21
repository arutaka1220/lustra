import { expect, test } from '@playwright/test'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const appUrl = process.env.LUSTRA_E2E_FILE_MODE === '1' ? pathToFileURL(resolve('dist/index.html')).href : '/'

test('Typography custom colors update the real preview and retain Auto state', async ({ page }) => {
  await page.goto(appUrl)
  await page.getByRole('button', { name: /import photos/i }).click()
  await page.locator('input[type=file]').first().setInputFiles([resolve('src-tauri/tests/fixtures/test_exif_01.jpg')])
  await page.getByRole('button', { name: /import 1 photo/i }).click()
  await expect(page.getByRole('region', { name: /photos/i })).toBeVisible({ timeout: 10_000 })

  const layer = page.locator('.canvas-text--interactive').first()
  await expect(layer).toBeVisible()
  await layer.click()
  await page.getByRole('button', { name: /typography/i }).click()
  const custom = page.getByRole('button', { name: 'Custom', exact: true })
  await custom.click()

  const trigger = page.getByRole('button', { name: /choose custom text color/i })
  await trigger.click()
  const picker = page.getByRole('dialog', { name: 'Text color' })
  const hex = picker.getByRole('textbox', { name: 'HEX' })
  await hex.fill('#E8C7A4')
  await expect(layer).toHaveCSS('color', 'rgb(232, 199, 164)')

  await picker.getByRole('button', { name: 'RGB', exact: true }).click()
  await picker.getByRole('textbox', { name: 'R' }).fill('32')
  await expect(layer).toHaveCSS('color', 'rgb(32, 199, 164)')
  await picker.getByRole('button', { name: 'HEX', exact: true }).click()
  const rgbColor = '#20C7A4'
  const paletteEntry = picker.getByRole('button', { name: `Apply ${rgbColor}` })
  if (await paletteEntry.count() === 0) {
    await picker.getByRole('button', { name: /save current color/i }).click()
  }
  await expect(picker.getByRole('button', { name: `Apply ${rgbColor}` })).toBeVisible()
  await hex.fill('#AA0000')
  await picker.getByRole('button', { name: `Apply ${rgbColor}` }).click()
  await expect(layer).toHaveCSS('color', 'rgb(32, 199, 164)')

  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Auto', exact: true }).click()
  await expect(layer).toHaveCSS('color', 'rgb(255, 255, 255)')
  await custom.click()
  await expect(layer).toHaveCSS('color', 'rgb(32, 199, 164)')
})
