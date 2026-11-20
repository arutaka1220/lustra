import { expect, test } from '@playwright/test'
import { resolve } from 'node:path'

test('Lustra home suspends edits and a new import starts an independent session', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /import photos/i }).click()
  await page.locator('input[type=file]').first().setInputFiles(resolve('test-data/DSC_8575.jpg'))
  await page.getByRole('button', { name: /import 1 photo/i }).click()
  await expect(page.getByRole('region', { name: /photos/i })).toBeVisible()
  const top = page.getByRole('spinbutton', { name: 'Top' })
  await top.fill('19')
  await top.press('Enter')
  await page.getByRole('button', { name: /lustra home/i }).click()
  await expect(page.getByRole('heading', { name: /suspended sessions/i })).toBeVisible()
  await page.getByRole('button', { name: /resume dsc_8575\.jpg/i }).click()
  await expect(page.getByRole('region', { name: /photos/i })).toBeVisible()
  await expect(page.getByRole('spinbutton', { name: 'Top' })).toHaveValue('19')

  await page.getByRole('button', { name: /lustra home/i }).click()
  await page.getByRole('button', { name: /import photos/i }).click()
  await page.locator('input[type=file]').first().setInputFiles(resolve('test-data/DSC_8575.jpg'))
  await page.getByRole('button', { name: /import 1 photo/i }).click()
  await expect(page.getByRole('region', { name: /photos/i })).toBeVisible()
  await expect(page.getByRole('spinbutton', { name: 'Top' })).toHaveValue('8')
  await page.getByRole('button', { name: /lustra home/i }).click()
  await expect(page.getByRole('heading', { name: /suspended sessions/i })).toBeVisible()
})
