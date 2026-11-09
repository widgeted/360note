#!/usr/bin/env node
/**
 * Responsive/theme audit: key pages at 390/768/1024/1440 in light and dark
 * mode must not overflow horizontally, and settings list rows must fit.
 * Requires NH_TEST_EMAIL / NH_TEST_PASSWORD and a running API.
 */
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8787';
const EMAIL = process.env.NH_TEST_EMAIL;
const PASSWORD = process.env.NH_TEST_PASSWORD;
if (!EMAIL || !PASSWORD) throw new Error('NH_TEST_EMAIL / NH_TEST_PASSWORD are required');

const sizes = [390, 768, 1024, 1440];
const themes = ['light', 'dark'];
const paths = [
  '/',
  '/login',
  '/app',
  '/app/settings/security',
  '/app/settings/team',
  '/app/settings/data',
  '/app/settings/appearance',
  '/app/settings/account',
];
const problems = [];
const browser = await chromium.launch({ headless: true });

try {
  const seed = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'zh-CN',
    extraHTTPHeaders: { 'x-forwarded-for': `198.51.100.${Math.floor(Math.random() * 200) + 20}` },
  });
  const seedPage = await seed.newPage();
  await seedPage.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await seedPage.fill('#login-email', EMAIL);
  await seedPage.fill('#login-password', PASSWORD);
  await seedPage.click('button[type=submit]');
  await seedPage.waitForURL('**/app');
  const storageState = await seed.storageState();
  await seed.close();

  for (const width of sizes) {
    for (const theme of themes) {
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        locale: 'zh-CN',
        colorScheme: theme,
        storageState,
      });
      await context.addInitScript((value) => localStorage.setItem('nh-theme', value), theme);
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(`PAGE ${error.message}`));
      page.on('console', (message) => {
        if (message.type() === 'error' && !message.text().includes('401')) errors.push(`CONSOLE ${message.text()}`);
      });
      await page.goto(`${BASE}/app`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(400);
      const me = await (await page.request.get(`${BASE}/api/auth/me`)).json();
      const team = me.workspaces.find((workspace) => workspace.kind === 'team');

      for (const path of paths) {
        await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
        await page.waitForTimeout(300);
        const data = await page.evaluate(() => {
          const viewport = window.innerWidth;
          const offenders = [];
          for (const element of document.querySelectorAll('body *')) {
            const rect = element.getBoundingClientRect();
            if (rect.width < 1 || rect.height < 1) continue;
            if (element.closest('.sidebar, .toast-viewport, .cmdk-overlay, .slash-menu, [aria-hidden="true"], .modal-overlay')) continue;
            if (rect.right > viewport + 1 || rect.left < -1) {
              offenders.push({
                tag: element.tagName,
                className: String(element.className).slice(0, 50),
                text: (element.textContent || '').trim().slice(0, 40),
              });
            }
          }
          return { documentWidth: document.documentElement.scrollWidth, viewport, offenders: offenders.slice(0, 10) };
        });
        if (data.documentWidth > width + 1 || data.offenders.length) problems.push({ width, theme, path, ...data });
      }

      if (team) {
        await page.evaluate((id) => localStorage.setItem('nh-workspace', id), team.id);
        await page.goto(`${BASE}/app/settings/team`, { waitUntil: 'networkidle' });
        await page.waitForTimeout(400);
        const rows = await page.evaluate(() => {
          const viewport = window.innerWidth;
          const bad = [];
          for (const element of document.querySelectorAll('.member-row, .invite-row, .audit-row, .setting-card, .settings-inner')) {
            const rect = element.getBoundingClientRect();
            if (rect.width < 1) continue;
            if (rect.right > viewport + 1 || element.scrollWidth > element.clientWidth + 2) {
              bad.push({ className: String(element.className).slice(0, 50), scrollWidth: element.scrollWidth, clientWidth: element.clientWidth });
            }
          }
          return { documentWidth: document.documentElement.scrollWidth, bad };
        });
        if (rows.documentWidth > width + 1 || rows.bad.length) problems.push({ width, theme, path: 'team rows', ...rows });
      }

      if (errors.length) problems.push({ width, theme, path: 'console', bad: errors.slice(0, 5) });
      await context.close();
    }
  }
} finally {
  await browser.close();
}

assert.deepEqual(problems, [], `responsive audit found issues:\n${JSON.stringify(problems, null, 2)}`);
console.log('PASS  390/768/1024/1440 · light/dark · key pages have no overflow or console errors');
