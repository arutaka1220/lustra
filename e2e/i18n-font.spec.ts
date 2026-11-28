import { expect, test } from '@playwright/test'

test('Gen Interface JP is the default Japanese UI font and language selection persists', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  const uiStack = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--font-ui'))
  expect(uiStack).toContain('Inter Variable')
  expect(uiStack).toContain('Gen Interface JP')

  await page.getByRole('button', { name: 'Preferences' }).click()
  await expect(page.getByRole('combobox')).toHaveCount(1)
  await page.getByRole('combobox').first().click()
  await page.getByRole('option', { name: '日本語' }).click()
  await expect(page.getByRole('heading', { name: '設定' })).toBeVisible()
  await expect(page.getByRole('combobox')).toHaveCount(1)
  await page.evaluate(async () => { await document.fonts.load('400 16px "Gen Interface JP"', '日本語') })
  await expect.poll(() => page.evaluate(() => document.fonts.check('400 16px "Gen Interface JP"', '日本語'))).toBe(true)
  await page.reload()
  await expect.poll(() => page.evaluate(() => localStorage.getItem('lustra.language'))).toBe('ja')
  await page.evaluate(async () => { await document.fonts.load('400 16px "Gen Interface JP"', '日本語') })
  await expect.poll(() => page.evaluate(() => document.fonts.check('400 16px "Gen Interface JP"', '日本語'))).toBe(true)
})
