#!/usr/bin/env node
/**
 * UI regression: breadcrumb space label, title placeholder, hit areas, nested
 * folder creation, theme variants, mobile toast offset/overflow and focus ring.
 * Requires NH_TEST_EMAIL / NH_TEST_PASSWORD and a running API.
 */
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8787';
const EMAIL = process.env.NH_TEST_EMAIL;
const PASSWORD = process.env.NH_TEST_PASSWORD;
if (!EMAIL || !PASSWORD) throw new Error('credentials required');
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 980 }, locale: 'zh-CN' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('PAGE:' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('401')) errors.push('CONSOLE:' + m.text()); });

await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
assert.equal(await page.locator('.landing-float').count(), 0, 'floating hero chips must not be rendered');
assert.equal(await page.locator('.landing-mock-note').count(), 3, 'hero demo must show a realistic note list');
assert.ok(await page.locator('.landing-mock-list').isVisible());
console.log('PASS  landing demo has a realistic list and no floating chips');

await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
await page.fill('#login-email', EMAIL);
await page.fill('#login-password', PASSWORD);
await page.click('button[type=submit]');
await page.waitForURL('**/app');
await page.locator('.note-item').first().waitFor();

const workspaceName = await page.locator('.workspace-name').innerText();
await page.locator('.note-item').first().click();
await page.waitForTimeout(800);
const breadcrumb = await page.locator('.topbar-breadcrumb .breadcrumb-item').first().innerText();
assert.equal(breadcrumb, workspaceName, 'breadcrumb root must show current workspace');
console.log('PASS  breadcrumb shows the current space');

const placeholderStyle = await page.evaluate(() => {
  const el = document.querySelector('.note-title-input');
  return el ? getComputedStyle(el, '::placeholder').fontStyle : null;
});
assert.equal(placeholderStyle, 'normal');
console.log('PASS  title placeholder is not italic');

const library = await page.evaluate(() => {
  const lib = document.querySelector('.sidebar-library');
  const tree = document.querySelector('.sidebar-tree');
  const tags = document.querySelector('.tag-scroll');
  return {
    overflow: lib ? getComputedStyle(lib).overflowY : null,
    shared: Boolean(lib && tree?.parentElement === lib && tags?.parentElement === lib),
  };
});
assert.equal(library.overflow, 'auto');
assert.equal(library.shared, true);
console.log('PASS  folders and tags share one scrollable library area');

const actionSize = await page.locator('.sidebar-section-action').first().evaluate((el) => {
  const r = el.getBoundingClientRect(); return { w: r.width, h: r.height };
});
assert.ok(actionSize.w >= 24 && actionSize.h >= 24, `sidebar hit area ${actionSize.w}x${actionSize.h}`);
console.log('PASS  sidebar action hit area is at least 24px');

// Folder menu creates a subfolder under the selected folder.
const workspaceId = await page.evaluate(() => localStorage.getItem('nh-workspace'));
const folder = page.locator('.tree-folder').first();
await folder.locator('.tree-folder-row').first().hover();
await folder.locator('.sidebar-section-action').first().click();
await page.getByText('新建子文件夹', { exact: true }).click();
await page.locator('input[placeholder="子文件夹名称"]').waitFor();
const subName = `子文件夹-${Date.now()}`;
await page.locator('input[placeholder="子文件夹名称"]').fill(subName);
await page.keyboard.press('Enter');
await page.getByText(subName, { exact: true }).waitFor();
const parentText = await page.locator('.tree-folder').first().innerText();
assert.ok(parentText.includes(subName), 'subfolder must render under the parent');
console.log('PASS  folder menu creates a nested subfolder');

const folders = await page.request.get(`${BASE}/api/folders?workspaceId=${workspaceId}`);
const folderList = (await folders.json()).folders;
const created = folderList.find((entry) => entry.name === subName);
assert.ok(created?.parentId, 'created folder must have a parentId');
await page.request.delete(`${BASE}/api/folders/${created.id}`, { headers: { 'x-360note-csrf': '1' } });
console.log('PASS  created subfolder is persisted with the correct parent');

await page.goto(`${BASE}/app/settings/appearance`, { waitUntil: 'networkidle' });
await page.locator('.theme-option').first().waitFor();
const themeInfo = await page.evaluate(() => [...document.querySelectorAll('.theme-option')].map((el) => ({
  style: el.getAttribute('style'),
  preview: el.querySelector('.theme-preview')?.dataset.preview,
  label: el.querySelector('.theme-option-label')?.textContent?.trim(),
})));
assert.equal(themeInfo.length, 3);
assert.ok(themeInfo.every((entry) => entry.style === null && entry.preview && entry.label));
console.log('PASS  theme preview cards use CSS variants without inline styles');

await page.getByRole('button', { name: '宽', exact: true }).click();
await page.waitForTimeout(350);
const wideWidth = await page.locator('.width-preview').evaluate((el) => el.getBoundingClientRect().width);
await page.getByRole('button', { name: '窄', exact: true }).click();
await page.waitForTimeout(350);
const narrowWidth = await page.locator('.width-preview').evaluate((el) => el.getBoundingClientRect().width);
assert.ok(narrowWidth < wideWidth * 0.8, `narrow preview ${narrowWidth} should be clearly narrower than ${wideWidth}`);
await page.getByRole('button', { name: '宽', exact: true }).click();
console.log('PASS  editor width preview reflects narrow and full-width modes');

// Mobile toast distance and horizontal fit.
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(`${BASE}/app/settings/appearance`, { waitUntil: 'networkidle' });
const toastBottom = await page.evaluate(() => {
  const el = document.createElement('div');
  el.className = 'toast-viewport';
  el.style.visibility = 'hidden';
  document.body.appendChild(el);
  const bottom = getComputedStyle(el).bottom;
  el.remove();
  return bottom;
});
assert.equal(toastBottom, '18px');
const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
assert.equal(overflow, false);
console.log('PASS  mobile toast sits 18px above the safe area and the page does not overflow');

// Keyboard focus remains visible.
await page.goto(`${BASE}/app`, { waitUntil: 'networkidle' });
await page.locator('.note-item').first().waitFor();
await page.keyboard.press('Tab');
const focus = await page.evaluate(() => {
  const el = document.activeElement;
  const s = getComputedStyle(el);
  return { tag: el?.tagName, outlineStyle: s.outlineStyle, outlineWidth: s.outlineWidth };
});
assert.ok(focus.outlineStyle !== 'none' && focus.outlineWidth !== '0px', JSON.stringify(focus));
console.log('PASS  keyboard focus has a visible outline');
console.log('errors', errors);
await browser.close();
