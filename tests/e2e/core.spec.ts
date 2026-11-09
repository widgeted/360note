import { test, expect, type Page } from '@playwright/test';

const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;

test.skip(!email || !password, 'Set E2E_EMAIL and E2E_PASSWORD to run authenticated Playwright tests.');

async function login(page: Page) {
  await page.goto('/login');
  await page.locator('input[type=email]').fill(email!);
  await page.locator('input[type=password]').fill(password!);
  await page.locator('button[type=submit]').click();
  await page.waitForURL('**/app');
  await expect(page.locator('.note-item').first()).toBeVisible();
}

async function cleanupCreatedNote(page: Page, noteId: string) {
  const headers = { 'x-360note-csrf': '1' };
  await page.request.delete(`/api/notes/${noteId}`, { headers });
  await page.request.delete(`/api/notes/${noteId}/permanent`, { headers });
}

test('desktop: create, edit, reload and search a note', async ({ page }) => {
  await login(page);
  const stamp = Date.now();
  const title = `E2E note ${stamp}`;
  await page.goto('/app/new');
  await page.waitForURL(/\/app\/note\/[0-9a-f-]+$/);
  const noteId = page.url().split('/').pop()!;

  await page.locator('.note-title-input').fill(title);
  await page.locator('.ProseMirror').click();
  await page.keyboard.type('A short Playwright body that survives reload.');
  await page.waitForTimeout(1200);
  await page.reload();
  await expect(page.locator('.note-title-input')).toHaveValue(title);
  await expect(page.locator('.ProseMirror')).toContainText('A short Playwright body');

  await page.keyboard.press('Control+k');
  await page.locator('.cmdk-input').fill(title);
  await expect(page.locator('.cmdk')).toContainText(title);

  await page.keyboard.press('Escape');
  await cleanupCreatedNote(page, noteId);
});

test('mobile: core editor controls fit without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.locator('.note-item').first().click();
  await page.waitForTimeout(700);
  const toolbar = page.locator('.editor-toolbar');
  await expect(toolbar).toBeVisible();
  const toolbarScrolls = await toolbar.evaluate((element) => element.scrollWidth > element.clientWidth + 1);
  expect(toolbarScrolls).toBe(true);
  await expect(page.getByRole('button', { name: /Clear formatting|清除格式/i })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflow).toBe(false);
});
