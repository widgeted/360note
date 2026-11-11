#!/usr/bin/env node
/**
 * Manual two-tab sync regression:
 * - tab B updates automatically after tab A saves, when B is clean
 * - tab B shows the remote-update banner when it has unsaved edits
 *
 * Run: sudo /opt/node22/bin/node tests/manual/cross-tab-sync-smoke.mjs
 */
import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';

const base = 'https://360note.com';
const credentials = await fs.readFile('/root/360note-credentials.txt', 'utf8');
const block = credentials.split('Demo account (normal user)')[1]?.split('Demo shares')[0] ?? '';
const email = /Email:\s*(\S+@\S+)/.exec(block)?.[1];
const password = /Password:\s*(\S+)/.exec(block)?.[1];
if (!email || !password) throw new Error('Could not read demo credentials');

const marker = `cross-tab-${Date.now()}`;
const results = {};
let noteId = null;
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'zh-CN' });
const a = await context.newPage();
const b = await context.newPage();
const errors = [];
for (const page of [a, b]) {
  page.on('pageerror', (error) => errors.push(`PAGE:${error.message}`));
}

try {
  await a.goto(`${base}/login`, { waitUntil: 'networkidle' });
  await a.fill('#login-email', email);
  await a.fill('#login-password', password);
  await a.click('button[type=submit]');
  await a.waitForURL(/\/app/, { timeout: 20_000 });
  await a.waitForTimeout(800);

  const workspaceId = await a.evaluate(async () => {
    const response = await fetch('/api/workspaces', { headers: { 'x-360note-csrf': '1' } });
    const data = await response.json();
    return data.workspaces.find((workspace) => workspace.kind === 'personal')?.id ?? data.workspaces[0]?.id;
  });
  const created = await a.evaluate(async ({ workspaceId, marker }) => {
    const response = await fetch('/api/notes', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-360note-csrf': '1' },
      body: JSON.stringify({ workspaceId, title: `__${marker}__`, contentMd: '# Cross-tab\n\nbase' }),
    });
    return { status: response.status, data: await response.json() };
  }, { workspaceId, marker });
  if (created.status !== 200) throw new Error(`create note failed: ${JSON.stringify(created.data)}`);
  noteId = created.data.note.id;

  await Promise.all([
    a.goto(`${base}/app/note/${noteId}`, { waitUntil: 'networkidle' }),
    b.goto(`${base}/app/note/${noteId}`, { waitUntil: 'networkidle' }),
  ]);
  await a.waitForSelector('.ProseMirror', { timeout: 10_000 });
  await b.waitForSelector('.ProseMirror', { timeout: 10_000 });
  await a.waitForTimeout(500);

  // A saves; B is clean and should update without a manual refresh.
  await a.locator('.ProseMirror').click();
  await a.keyboard.press('Control+End');
  await a.keyboard.type(' A-auto');
  await b.waitForFunction(() => document.querySelector('.ProseMirror')?.textContent?.includes('A-auto'), { timeout: 10_000 });
  results.cleanTabAutoUpdated = true;

  // B becomes dirty; delay its own save so A's save arrives first.
  await b.route('**/api/notes/*', async (route) => {
    if (route.request().method() === 'PATCH') {
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
    await route.continue();
  });
  await b.locator('.ProseMirror').click();
  await b.keyboard.press('Control+End');
  await b.keyboard.type(' B-local-unsaved');
  await a.locator('.ProseMirror').click();
  await a.keyboard.press('Control+End');
  await a.keyboard.type(' A-second');
  await a.keyboard.press('Control+s');
  await b.waitForSelector('.banner-warning', { timeout: 10_000 });
  const bannerText = await b.locator('.banner-warning').last().innerText();
  results.dirtyTabShowsRemoteBanner = /另一窗口已更新|Another tab updated/.test(bannerText);
  results.dirtyTabKeepsLocalText = (await b.locator('.ProseMirror').innerText()).includes('B-local-unsaved') || (await b.locator('.ProseMirror').textContent() ?? '').includes('B-local-unsaved');

  results.errors = errors.slice(0, 10);
  console.log(JSON.stringify(results, null, 2));
} finally {
  if (noteId) {
    await a.evaluate(async (id) => {
      await fetch(`/api/notes/${id}`, { method: 'DELETE', headers: { 'x-360note-csrf': '1' } });
      await fetch(`/api/notes/${id}/permanent`, { method: 'DELETE', headers: { 'x-360note-csrf': '1' } });
    }, noteId).catch(() => {});
  }
  await a.evaluate(async () => {
    await fetch('/api/auth/logout', { method: 'POST', headers: { 'x-360note-csrf': '1' } });
  }).catch(() => {});
  await browser.close();
}
