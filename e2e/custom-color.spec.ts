import { expect, test } from '@playwright/test'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const appUrl = process.env.LUSTRA_E2E_FILE_MODE === '1' ? pathToFileURL(resolve('dist/index.html')).href : '/'

test('custom color picker and palette work in the editor', async ({ page }) => {
  await page.goto(appUrl)
  await page.getByRole('button', { name: /import photos/i }).click()
  await page.locator('input[type=file]').first().setInputFiles([resolve('test-data/DSC_8575.jpg')])
  await expect(page.getByRole('heading', { name: /choose your photos/i })).toBeVisible()
  await page.getByRole('button', { name: /import 1 photo/i }).click()
  await expect(page.getByRole('region', { name: /photos/i })).toBeVisible({ timeout: 10_000 })

  const trigger = page.getByRole('button', { name: /custom frame color/i })
  await trigger.click()
  const picker = page.getByRole('dialog', { name: 'Frame Color' })
  await expect(picker).toBeVisible()
  const pickerBounds = await picker.boundingBox()
  const triggerBounds = await trigger.boundingBox()
  expect(pickerBounds && triggerBounds && pickerBounds.x >= triggerBounds.x + triggerBounds.width - 2).toBeTruthy()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: /^black$/i }).click()
  await trigger.click()
  await expect(picker).toBeVisible()
  await page.keyboard.press('Escape')
  await trigger.click()
  await expect(picker).toBeVisible()
  await expect(page.getByRole('button', { name: /choose custom frame color/i })).toHaveCount(0)

  const hex = picker.getByRole('textbox', { name: 'HEX' })
  await hex.fill('#123ABC')
  await expect(hex).toHaveValue('#123ABC')
  await expect(trigger.locator('.style-preview')).toHaveCSS('background-color', 'rgb(18, 58, 188)')
  await page.getByRole('button', { name: 'RGB', exact: true }).click()
  const red = picker.getByRole('textbox', { name: 'R' })
  await expect(red).toHaveValue('18')
  await red.fill('32')
  await page.getByRole('button', { name: 'HEX', exact: true }).click()
  await expect(hex).toHaveValue('#203ABC')

  await page.getByRole('button', { name: /save current color/i }).click()
  await expect(page.getByRole('button', { name: 'Apply #203ABC' })).toHaveAttribute('aria-pressed', 'true')
  await hex.fill('#AABBCC')
  await page.getByRole('button', { name: /add color to my palette/i }).click()
  await page.getByRole('button', { name: 'Apply #203ABC' }).click()
  await expect(hex).toHaveValue('#203ABC')
  page.once('dialog', dialog => dialog.accept('#654321'))
  await page.getByRole('button', { name: 'Edit selected color' }).click()
  await expect(page.getByRole('button', { name: 'Apply #654321' })).toBeVisible()
  await page.getByRole('button', { name: 'Apply #654321' }).click()
  await page.getByRole('button', { name: 'Remove' }).click()
  await expect(page.getByRole('button', { name: 'Apply #654321' })).toHaveCount(0)

  await page.keyboard.press('Escape')
  await expect(picker).toBeHidden()
  const padding = page.getByRole('heading', { name: 'Padding' })
  await expect(padding).toBeVisible()
})
