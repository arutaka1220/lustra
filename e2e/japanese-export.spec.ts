import { expect, test } from '@playwright/test'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const appUrl = process.env.LUSTRA_E2E_FILE_MODE === '1'
  ? pathToFileURL(resolve('dist/index.html')).href
  : '/'

test('Japanese photo workflow keeps localized copy through export settings', async ({ page }) => {
  await page.goto(appUrl)
  await page.getByRole('button', { name: 'Preferences' }).click()
  await page.getByRole('combobox').first().click()
  await page.getByRole('option', { name: '日本語' }).click()
  await expect(page.getByRole('heading', { name: '設定' })).toBeVisible()
  await page.getByRole('button', { name: '閉じる' }).click()

  await page.getByRole('button', { name: '写真を読み込む' }).click()
  await page.locator('input[type=file]').first().setInputFiles(resolve('src-tauri/tests/fixtures/test_exif_01.jpg'))
  await page.getByRole('button', { name: '1枚の写真を読み込む' }).click()
  await expect(page.getByRole('region', { name: /写真/ })).toBeVisible({ timeout: 10_000 })
  await page.getByRole('button', { name: '完了して次へ' }).click()
  await expect(page.getByRole('heading', { name: '仕上がりを確認' })).toBeVisible()

  await page.getByRole('button', { name: 'すべてを書き出す' }).click()
  await expect(page.getByRole('heading', { name: '写真を書き出す' })).toBeVisible()
  await expect(page.getByText('写真を書き出すには、デスクトップ版のLustraを開いてください。')).toBeVisible()
  await page.getByRole('button', { name: '仕上がり確認に戻る' }).click()
  await expect(page.getByRole('heading', { name: '仕上がりを確認' })).toBeVisible()
})
