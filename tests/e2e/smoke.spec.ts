import { expect, test, type Page } from '@playwright/test'

async function login(page: Page) {
  await page.goto('/login')
  await expect(page.getByRole('heading', { name: '登录' })).toBeVisible()
  await page.getByRole('textbox', { name: '邮箱' }).fill('dev@example.com')
  await page.getByRole('textbox', { name: '密码' }).fill('dev-password')
  await page.getByRole('button', { name: '登录' }).click()
  await expect(page).toHaveURL(/\/overview/)
}

test.describe('smoke', () => {
  test('login then open overview', async ({ page }) => {
    await login(page)
    await expect(page.getByRole('heading', { name: '系统概览', exact: true }).first()).toBeVisible()
  })

  test('market can start chat', async ({ page }) => {
    await login(page)
    await page.goto('/market')
    await expect(page).toHaveURL(/\/market/)

    const startButton = page.getByRole('button', { name: /^开始对话(\s*chat)?$/ }).first()
    await expect(startButton).toBeVisible()
    await startButton.click()

    await expect(page).toHaveURL(/\/chat/)
  })
})
