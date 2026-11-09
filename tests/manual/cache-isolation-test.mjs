#!/usr/bin/env node
/**
 * Browser regression: a second account must not see the first account's local
 * IndexedDB note cache, and the explicit “sign out and clear this device”
 * action must remove all local note data.
 *
 * Required env:
 *   CACHE_TEST_DEMO_EMAIL / CACHE_TEST_DEMO_PASSWORD
 *   CACHE_TEST_ADMIN_EMAIL / CACHE_TEST_ADMIN_PASSWORD
 * Optional: BASE_URL (default https://360note.com)
 */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const BASE = process.env.BASE_URL || 'https://360note.com';
const demo = {
  email: process.env.CACHE_TEST_DEMO_EMAIL,
  password: process.env.CACHE_TEST_DEMO_PASSWORD,
};
const admin = {
  email: process.env.CACHE_TEST_ADMIN_EMAIL,
  password: process.env.CACHE_TEST_ADMIN_PASSWORD,
};
if (!demo.email || !demo.password || !admin.email || !admin.password) {
  console.error('CACHE_TEST_DEMO_* and CACHE_TEST_ADMIN_* are required');
  process.exit(1);
}

async function login(page, account) {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.fill('input[type=email]', account.email);
  await page.fill('input[type=password]', account.password);
  await page.click('button[type=submit]');
  await page.waitForURL('**/app', { timeout: 30_000 });
  await page.waitForTimeout(800);
}

async function idbKeys(page) {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open('keyval-store');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const transaction = db.transaction('keyval', 'readonly');
          const keys = transaction.objectStore('keyval').getAllKeys();
          keys.onsuccess = () => resolve(keys.result);
          keys.onerror = () => reject(keys.error);
        };
      }),
  );
}

async function clickUserMenu(page, label) {
  await page.getByRole('button', { name: /account menu|账户菜单/i }).click();
  await page.getByRole('button', { name: label }).click();
  await page.waitForURL('**/login', { timeout: 15_000 });
  await page.waitForTimeout(500);
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
page.on('dialog', (dialog) => dialog.accept());

try {
  await login(page, demo);
  await page.locator('.note-item').first().click();
  await page.waitForTimeout(1000);
  const noteId = page.url().split('/').pop();
  const before = await idbKeys(page);
  assert.ok(before.includes(`nh:v1:note:${noteId}`), 'demo note should be cached before logout');

  // Normal logout keeps the same-user offline cache for fast recovery.
  await clickUserMenu(page, /^(Sign out|退出登录)$/);
  const afterNormalLogout = await idbKeys(page);
  assert.ok(afterNormalLogout.includes(`nh:v1:note:${noteId}`), 'normal logout should keep local cache');
  console.log('PASS  normal logout keeps this user’s offline cache');

  // Logging into a different account must clear the previous account's data.
  await login(page, admin);
  const afterAccountSwitch = await idbKeys(page);
  assert.ok(!afterAccountSwitch.includes(`nh:v1:note:${noteId}`), 'account switch must not expose previous cache');
  console.log('PASS  switching accounts clears the previous account cache');

  // Explicit clear logout removes all local note data for this browser.
  await clickUserMenu(page, /^(Sign out and clear this device|退出并清除本机数据)$/);
  const afterClear = await idbKeys(page);
  assert.equal(afterClear.length, 0, 'explicit clear logout should remove IndexedDB keys');
  const local = await page.evaluate(() => ({
    auth: localStorage.getItem('nh-auth-cache'),
    workspace: localStorage.getItem('nh-workspace'),
  }));
  assert.equal(local.auth, null);
  assert.equal(local.workspace, null);
  console.log('PASS  explicit clear logout removes local note data and auth/workspace keys');
} finally {
  await browser.close();
}
