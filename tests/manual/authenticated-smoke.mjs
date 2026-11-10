#!/usr/bin/env node
/**
 * Authenticated production smoke test. Uses the operator-maintained credential
 * file by default; never prints the password. The session is logged out at the
 * end. Run: sudo /opt/node22/bin/node tests/manual/authenticated-smoke.mjs
 */
import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';

async function credentials() {
  if (process.env.NH_TEST_EMAIL && process.env.NH_TEST_PASSWORD) {
    return { email: process.env.NH_TEST_EMAIL, password: process.env.NH_TEST_PASSWORD };
  }
  const text = await fs.readFile('/root/360note-credentials.txt', 'utf8');
  const block = process.env.NH_ACCOUNT === 'demo'
    ? text.split('Demo account (normal user)')[1]?.split('Demo shares')[0] ?? ''
    : text.split('Demo account (normal user)')[0];
  const email = /Email:\s*(\S+@\S+)/.exec(block)?.[1];
  const password = /Password:\s*(\S+)/.exec(block)?.[1];
  if (!email || !password) throw new Error('Could not read administrator credentials');
  return { email, password };
}

const { email, password } = await credentials();
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const results = {};
const errors = [];
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 950 }, locale: 'zh-CN' });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(`PAGE:${error.message}`));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (text.includes('status of 401')) return;
    errors.push(`CONSOLE:${text}`);
  });

  await page.goto('https://360note.com/login', { waitUntil: 'networkidle' });
  await page.fill('#login-email', email);
  await page.fill('#login-password', password);
  await page.click('button[type=submit]');
  await page.waitForTimeout(3500);
  results.loggedIn = page.url().includes('/app');
  if (!results.loggedIn) {
    results.loginUrl = page.url();
    results.loginError = (await page.locator('.form-error, .banner, body').first().innerText().catch(() => '')).slice(0, 200);
    results.errors = errors.slice(0, 10);
    console.log(JSON.stringify(results, null, 2));
    process.exit(0);
  }
  await page.waitForTimeout(1000);
  results.noteCount = await page.locator('.note-item').count();
  if (results.noteCount > 0) {
    await page.locator('.note-item').first().click();
    await page.waitForTimeout(1200);
    results.editorVisible = await page.locator('.editor-page').isVisible().catch(() => false);
  }

  await page.goto('https://360note.com/app/settings/security', { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  const twoFactorButton = page.locator('button', { hasText: /开启两步验证|Enable two-factor/i }).first();
  if (await twoFactorButton.count()) {
    await twoFactorButton.click();
    await page.waitForTimeout(300);
    results.twoFactorPasswordField = await page.locator('.modal input[type=password]').count();
    results.twoFactorQrVisibleBeforePassword = await page.locator('.modal img[alt="2FA QR"]').count();
    await page.keyboard.press('Escape');
  }

  if ((await page.locator('.admin-tab').count()) > 0 || (await page.locator('button', { hasText: /实例管理|Instance/i }).count()) > 0) {
    await page.goto('https://360note.com/app/settings/admin', { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    results.adminVisible = (await page.locator('.admin-tabs').count()) > 0;
  }
  await page.screenshot({ path: '/tmp/opencode/auth-desktop.png', fullPage: false });

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-CN' });
  const mobilePage = await mobile.newPage();
  mobilePage.on('pageerror', (error) => errors.push(`MOBILE-PAGE:${error.message}`));
  await mobilePage.goto('https://360note.com/login', { waitUntil: 'networkidle' });
  await mobilePage.fill('#login-email', email);
  await mobilePage.fill('#login-password', password);
  await mobilePage.click('button[type=submit]');
  await mobilePage.waitForURL(/\/app/, { timeout: 20_000 });
  await mobilePage.goto('https://360note.com/app/settings/account', { waitUntil: 'networkidle' });
  await mobilePage.waitForTimeout(700);
  const nav = mobilePage.locator('.settings-nav');
  results.mobileSettingsColumns = await nav.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').filter(Boolean).length);
  results.mobileOverflow = await mobilePage.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  await mobilePage.screenshot({ path: '/tmp/opencode/auth-mobile-settings.png', fullPage: false });

  const sw = await page.evaluate(async () => Boolean(await navigator.serviceWorker.getRegistration()));
  results.serviceWorker = sw;
  for (const current of [page, mobilePage]) {
    await current.evaluate(async () => {
      await fetch('/api/auth/logout', { method: 'POST', headers: { 'x-360note-csrf': '1' } });
    }).catch(() => {});
  }
  await mobile.close();
  await context.close();
} finally {
  await browser.close();
}
results.errors = errors.slice(0, 10);
console.log(JSON.stringify(results, null, 2));
if (!results.loggedIn || results.errors.length) process.exitCode = 1;
