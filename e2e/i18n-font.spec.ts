import { expect, test } from '@playwright/test'

test('language and development Japanese font selections apply and persist', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Preferences' }).click()
  await page.getByRole('combobox').first().click()
  await page.getByRole('option', { name: '日本語' }).click()
  await expect(page.getByRole('heading', { name: '設定' })).toBeVisible()

  const fontPicker = page.getByRole('combobox', { name: '日本語UIフォント（開発用）' })
  await expect(fontPicker).toBeVisible()
  await fontPicker.click()
  await page.getByRole('option', { name: 'M PLUS 1' }).click()
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.japaneseFont)).toBe('m-plus')
  await expect.poll(() => page.evaluate(() => localStorage.getItem('lustra.preferences.ui.japaneseFont'))).toBe('"m-plus"')
  await page.reload()
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.japaneseFont)).toBe('m-plus')
  await expect.poll(() => page.evaluate(() => localStorage.getItem('lustra.language'))).toBe('ja')
})
