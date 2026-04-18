import { expect, test, type Page } from '@playwright/test'

async function login(page: Page) {
  await page.goto('/login')
  await expect(page.getByRole('heading', { name: '登录' })).toBeVisible()
  await page.getByRole('textbox', { name: '邮箱' }).fill('dev@example.com')
  await page.getByRole('textbox', { name: '密码' }).fill('dev-password')
  await page.getByRole('button', { name: '登录' }).click()
  await expect(page).toHaveURL(/\/overview/)
}

test.describe('deep-regression', () => {
  test('auth guard redirects to login', async ({ page }) => {
    await page.goto('/overview')
    await expect(page).toHaveURL(/\/login/)
    await expect(page.getByRole('heading', { name: '登录' })).toBeVisible()
  })

  test('main navigation visits all core pages', async ({ page }) => {
    await login(page)

    await expect(page.locator('main[data-page-route="/overview"]')).toBeVisible()

    await page.getByRole('link', { name: /知识库管理/ }).click()
    await expect(page).toHaveURL(/\/knowledge/)
    await expect(page.locator('main[data-page-route="/knowledge"]')).toBeVisible()

    await page.getByRole('link', { name: /历史会话管理/ }).click()
    await expect(page).toHaveURL(/\/history/)
    await expect(page.locator('main[data-page-route="/history"]')).toBeVisible()

    await page.getByRole('link', { name: /分析详情与洞察/ }).click()
    await expect(page).toHaveURL(/\/analysis/)
    await expect(page.locator('main[data-page-route="/analysis"]')).toBeVisible()

    await page.getByRole('link', { name: /智能体市场/ }).click()
    await expect(page).toHaveURL(/\/market/)
    await expect(page.locator('main[data-page-route="/market"]')).toBeVisible()
  })

  test('market start-chat jumps to chat page', async ({ page }) => {
    await login(page)
    await page.goto('/market')
    await expect(page.locator('main[data-page-route="/market"]')).toBeVisible()

    const startButton = page.getByRole('button', { name: /^开始对话(\s*chat)?$/ }).first()
    await expect(startButton).toBeVisible()
    await startButton.click()

    await expect(page).toHaveURL(/\/chat/)
    await expect(page.locator('main[data-page-route="/chat"]')).toBeVisible()
  })

  test('chat composer and session controls are visible', async ({ page }) => {
    await login(page)
    await page.goto('/chat')
    await expect(page.locator('main[data-page-route="/chat"]')).toBeVisible()

    await expect(page.getByPlaceholder("向智能助手提问，例如 '分析本季度的毛利构成'...")).toBeVisible()
    await expect(page.getByRole('button', { name: /新会话/ })).toBeVisible()
    await expect(page.getByRole('button', { name: '附件、图片与对话模型' })).toBeVisible()
  })

  test('knowledge/history/analysis key controls render', async ({ page }) => {
    await login(page)

    await page.goto('/knowledge')
    await expect(page.getByRole('heading', { name: '知识库管理' })).toBeVisible()
    await expect(page.getByRole('button', { name: '上传文档' })).toBeVisible()

    await page.goto('/history')
    await expect(page.getByRole('heading', { name: '历史会话' })).toBeVisible()
    await expect(page.getByPlaceholder('按标题搜索…')).toBeVisible()

    await page.goto('/analysis')
    await expect(page.getByRole('heading', { name: '分析与洞察' })).toBeVisible()
    await expect(page.getByLabel('刷新分析')).toBeVisible()
  })
})
