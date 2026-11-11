#!/usr/bin/env node
/**
 * Manual PWA update-prompt regression:
 * - same build + waiting worker => no prompt
 * - newer build + waiting worker on /app => prompt with PwaNotice layout
 * - newer build + waiting worker on a public share route => no prompt
 *
 * Run: sudo /opt/node22/bin/node tests/manual/pwa-update-smoke.mjs
 */
import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';

const credentials = await fs.readFile('/root/360note-credentials.txt', 'utf8');
const block = credentials.split('Demo account (normal user)')[1]?.split('Demo shares')[0] ?? '';
const email = /Email:\s*(\S+@\S+)/.exec(block)?.[1];
const password = /Password:\s*(\S+)/.exec(block)?.[1];
if (!email || !password) throw new Error('Could not read demo credentials');

const headed = process.env.HEADED === '1';
const browser = await chromium.launch({ headless: !headed, slowMo: headed ? 350 : 0, args: ['--no-sandbox'] });
const results = {};

async function contextWithWaitingWorker() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 950 }, locale: 'zh-CN' });
  await context.addInitScript(() => {
    const waiting = { state: 'installed', postMessage() {} };
    const registration = {
      waiting,
      installing: null,
      addEventListener() {},
      update: async () => {},
      showNotification: async () => {},
    };
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        controller: {},
        ready: Promise.resolve(registration),
        register: async () => registration,
        addEventListener() {},
        removeEventListener() {},
        getRegistration: async () => registration,
      },
    });
  });
  return context;
}

try {
  // Same build: waiting worker exists but version.json matches the page meta.
  const sameContext = await contextWithWaitingWorker();
  const samePage = await sameContext.newPage();
  await samePage.goto('https://360note.com/login', { waitUntil: 'networkidle' });
  await samePage.fill('#login-email', email);
  await samePage.fill('#login-password', password);
  await samePage.click('button[type=submit]');
  await samePage.waitForURL(/\/app/, { timeout: 20_000 });
  await samePage.waitForTimeout(1500);
  results.sameBuildPromptHidden = (await samePage.locator('.pwa-notice.is-top').count()) === 0;
  await samePage.evaluate(async () => {
    await fetch('/api/auth/logout', { method: 'POST', headers: { 'x-360note-csrf': '1' } });
  }).catch(() => {});
  await sameContext.close();

  // Newer build: route version.json to a different build.
  const newContext = await contextWithWaitingWorker();
  await newContext.route('**/version.json*', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ version: '9.9.9', build: 'different-build' }),
  }));
  const page = await newContext.newPage();
  await page.goto('https://360note.com/login', { waitUntil: 'networkidle' });
  await page.fill('#login-email', email);
  await page.fill('#login-password', password);
  await page.click('button[type=submit]');
  await page.waitForURL(/\/app/, { timeout: 20_000 });
  const notice = page.locator('.pwa-notice.is-top');
  await notice.waitFor({ state: 'visible', timeout: 10_000 });
  const cardBox = await notice.boundingBox();
  const closeBox = await notice.locator('.pwa-notice-close').boundingBox();
  const iconBox = await notice.locator('.pwa-notice-icon').boundingBox();
  const titleBox = await notice.locator('.pwa-notice-title').boundingBox();
  const actionBox = await notice.locator('.pwa-notice-actions .btn').boundingBox();
  results.newerBuildPromptVisible = Boolean(cardBox && titleBox && actionBox);
  results.closeTopRight = Boolean(cardBox && closeBox) && closeBox.x + closeBox.width > cardBox.x + cardBox.width - 20 && closeBox.y < titleBox.y + 8;
  results.iconCloseToTitle = Boolean(iconBox && titleBox) && titleBox.x - (iconBox.x + iconBox.width) <= 8;
  results.actionBottomRight = Boolean(actionBox && cardBox && titleBox) && actionBox.y > titleBox.y + titleBox.height && actionBox.x + actionBox.width > cardBox.x + cardBox.width - 20;
  results.noticeTitle = await notice.locator('.pwa-notice-title').innerText();
  if (process.env.PAUSE === '1') await page.pause();
  await page.screenshot({ path: '/tmp/opencode/pwa-update-desktop.png', fullPage: false });
  results.desktopScreenshot = '/tmp/opencode/pwa-update-desktop.png';

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: 'networkidle' });
  const mobileNotice = page.locator('.pwa-notice.is-top');
  await mobileNotice.waitFor({ state: 'visible', timeout: 10_000 });
  await page.screenshot({ path: '/tmp/opencode/pwa-update-mobile.png', fullPage: false });
  results.mobileScreenshot = '/tmp/opencode/pwa-update-mobile.png';

  await mobileNotice.locator('.pwa-notice-close').click();
  results.dismissHidesPrompt = (await page.locator('.pwa-notice.is-top').count()) === 0;

  // Public share route: same newer build, but no prompt.
  await page.goto('https://360note.com/s/not-a-real-token', { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  results.shareRoutePromptHidden = (await page.locator('.pwa-notice.is-top').count()) === 0;

  await page.evaluate(async () => {
    await fetch('/api/auth/logout', { method: 'POST', headers: { 'x-360note-csrf': '1' } });
  }).catch(() => {});
  await newContext.close();

  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser.close();
}
