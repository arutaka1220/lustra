import { expect, test } from '@playwright/test'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const appUrl = process.env.LUSTRA_E2E_FILE_MODE === '1' ? pathToFileURL(resolve('dist/index.html')).href : '/'

test('Frame controls apply one manual text color to every layer and retain it across Auto changes', async ({ page }) => {
  await page.goto(appUrl)
  await page.getByRole('button', { name: /import photos/i }).click()
  await page.locator('input[type=file]').first().setInputFiles([resolve('src-tauri/tests/fixtures/test_exif_01.jpg')])
  await page.getByRole('button', { name: /import 1 photo/i }).click()
  await expect(page.getByRole('region', { name: /photos/i })).toBeVisible({ timeout: 10_000 })

  const layers = page.locator('.canvas-text--interactive')
  await expect(layers.first()).toBeVisible()
  const frameSection = page.getByRole('button', { name: 'Frame', exact: true })
  if (await frameSection.getAttribute('aria-expanded') !== 'true') await frameSection.click()
  const autoSwitch = page.getByRole('switch', { name: /auto text color/i })
  await expect(autoSwitch).toHaveAttribute('aria-checked', 'true')
  await expect(layers.first()).toHaveCSS('color', 'rgb(255, 255, 255)')

  await autoSwitch.click()
  await expect(autoSwitch).toHaveAttribute('aria-checked', 'false')
  const trigger = page.getByRole('button', { name: /choose custom text color/i })
  await trigger.click()
  const picker = page.getByRole('dialog', { name: 'Text color' })
  const hex = picker.getByRole('textbox', { name: 'HEX' })
  await hex.fill('#E8C7A4')
  await expect(layers.first()).toHaveCSS('color', 'rgb(232, 199, 164)')
  await picker.getByRole('button', { name: 'RGB', exact: true }).click()
  await picker.getByRole('textbox', { name: 'R' }).fill('32')
  await expect(layers.first()).toHaveCSS('color', 'rgb(32, 199, 164)')

  await page.keyboard.press('Escape')
  await autoSwitch.click()
  await expect(layers.first()).toHaveCSS('color', 'rgb(255, 255, 255)')
  await page.getByRole('button', { name: 'White', exact: true }).click()
  await expect(layers.first()).toHaveCSS('color', 'rgb(0, 0, 0)')
  await autoSwitch.click()
  await expect(layers.first()).toHaveCSS('color', 'rgb(32, 199, 164)')
  await expect(page.getByRole('button', { name: /typography/i })).toBeVisible()
  const typographySection = page.getByRole('button', { name: /typography/i })
  if (await typographySection.getAttribute('aria-expanded') !== 'true') await typographySection.click()
  const typographyPanel = page.locator('.inspector-section').filter({ has: typographySection })
  await expect(typographyPanel.getByText('Text Color', { exact: true })).toHaveCount(0)
})
