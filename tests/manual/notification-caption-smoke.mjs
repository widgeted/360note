#!/usr/bin/env node
/**
 * Manual production regression for notification unread/expand, the independent
 * all-notes count, and image captions in editor/share/print.
 *
 * Requires DATABASE_URL and /root/360note-credentials.txt.
 * Run: sudo bash -c 'set -a; source /etc/360note/360note.env; set +a;
 *   /opt/node22/bin/node tests/manual/notification-caption-smoke.mjs'
 */
import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
import pg from 'pg';

const base = 'https://360note.com';
const credentials = await fs.readFile('/root/360note-credentials.txt', 'utf8');
const block = credentials.split('Demo account (normal user)')[1]?.split('Demo shares')[0] ?? '';
const email = /Email:\s*(\S+@\S+)/.exec(block)?.[1];
const password = /Password:\s*(\S+)/.exec(block)?.[1];
if (!email || !password) throw new Error('Could not read demo credentials');

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const marker = `regression-${Date.now()}`;
const notificationBody = `${'通知正文摘要 '.repeat(20)}${marker}-end`;
const noteTitle = `__caption_${marker}__`;
const attachmentId = '544dd0c3-727e-4665-8b08-3e074f3ed5eb';
const results = {};
let notificationId = null;
let noteId = null;

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 950 }, locale: 'zh-CN' });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(`PAGE:${error.message}`));
page.on('console', (message) => {
  if (message.type() !== 'error') return;
  if (message.text().includes('status of 401') || message.text().includes('status of 404')) return;
  errors.push(`CONSOLE:${message.text()}`);
});

try {
  const notification = await pool.query(
    `INSERT INTO notifications (user_id, type, title, body, link)
     SELECT id, 'security', 'Unread regression', $1, '/app' FROM users WHERE lower(email) = lower($2)
     RETURNING id`,
    [notificationBody, email],
  );
  notificationId = notification.rows[0]?.id ?? null;
  if (!notificationId) throw new Error('Could not create regression notification');

  await page.goto(`${base}/login`, { waitUntil: 'networkidle' });
  await page.fill('#login-email', email);
  await page.fill('#login-password', password);
  await page.click('button[type=submit]');
  await page.waitForURL(/\/app/, { timeout: 20_000 });
  await page.waitForTimeout(1200);

  const allNotesNav = page.locator('.nav-item', { hasText: /全部笔记|All notes/ }).first();
  const allCountBefore = (await allNotesNav.locator('.nav-count').innerText()).trim();
  await page.locator('.nav-item', { hasText: /收藏|Favorites/ }).first().click();
  await page.waitForTimeout(800);
  const allCountAfter = (await allNotesNav.locator('.nav-count').innerText()).trim();
  results.allNotesCountStable = allCountBefore === allCountAfter;
  results.allNotesCount = allCountBefore;
  await allNotesNav.click();
  await page.waitForTimeout(600);

  await page.locator('button[aria-label="通知"], button[aria-label="Notifications"]').first().click();
  await page.waitForTimeout(400);
  const unreadItem = page.locator('.notification-item.is-unread').first();
  await unreadItem.waitFor({ state: 'visible', timeout: 10_000 });
  const backgroundColor = await unreadItem.evaluate((element) => getComputedStyle(element).backgroundColor);
  const collapsedText = await unreadItem.innerText();
  results.unreadHasGreenBackground = backgroundColor !== 'rgba(0, 0, 0, 0)' && backgroundColor !== 'transparent';
  results.unreadBackground = backgroundColor;
  results.collapsedHidesFullBody = !collapsedText.includes(`${marker}-end`);
  await unreadItem.locator('.notification-summary').click();
  await page.waitForTimeout(1000);
  const expandedItem = page.locator('.notification-item.is-expanded').first();
  const expandedText = await expandedItem.innerText();
  results.expandedShowsFullBody = expandedText.includes(`${marker}-end`);
  results.expandedTextLength = expandedText.length;
  results.expandedTextTail = expandedText.slice(-80);
  results.unreadCountAfter = await page.locator('.notification-item.is-unread').count();
  results.notificationItems = await page.locator('.notification-item').count();
  results.markedReadOnExpand = results.unreadCountAfter === 0;
  results.actionVisible = (await expandedItem.locator('.notification-action').count()) === 1;
  await page.keyboard.press('Escape');

  const workspaceId = await page.evaluate(async () => {
    const response = await fetch('/api/workspaces', { headers: { 'x-360note-csrf': '1' } });
    const data = await response.json();
    return data.workspaces.find((workspace) => workspace.kind === 'personal')?.id ?? data.workspaces[0]?.id;
  });
  const created = await page.evaluate(async ({ workspaceId, noteTitle, attachmentId }) => {
    const response = await fetch('/api/notes', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-360note-csrf': '1' },
      body: JSON.stringify({
        workspaceId,
        title: noteTitle,
        contentMd: `# Caption\n\n![alt](/api/attachments/${attachmentId}/content "Captioned image")`,
      }),
    });
    return { status: response.status, data: await response.json() };
  }, { workspaceId, noteTitle, attachmentId });
  if (created.status !== 200) throw new Error(`create note failed: ${JSON.stringify(created.data)}`);
  noteId = created.data.note.id;

  await page.goto(`${base}/app/note/${noteId}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.editor-figure figcaption', { timeout: 10_000 });
  results.editorCaption = (await page.locator('.editor-figure figcaption').first().innerText()).trim();

  const share = await page.evaluate(async (id) => {
    const response = await fetch(`/api/notes/${id}/shares`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-360note-csrf': '1' },
      body: JSON.stringify({ permission: 'view' }),
    });
    return { status: response.status, data: await response.json() };
  }, noteId);
  if (share.status !== 200) throw new Error(`share failed: ${JSON.stringify(share.data)}`);
  await page.goto(`${base}/s/${share.data.share.token}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.public-body .prose-figure figcaption', { timeout: 10_000 });
  results.shareCaptionAlign = await page.locator('.public-body .prose-figure figcaption').first().evaluate((element) => getComputedStyle(element).textAlign);
  await page.emulateMedia({ media: 'print' });
  results.printCaptionAlign = await page.locator('.prose-figure figcaption').first().evaluate((element) => getComputedStyle(element).textAlign);

  results.errors = errors.slice(0, 10);
  console.log(JSON.stringify(results, null, 2));
} finally {
  await page.emulateMedia({ media: 'screen' }).catch(() => {});
  if (noteId) {
    await page.evaluate(async (id) => {
      await fetch(`/api/notes/${id}`, { method: 'DELETE', headers: { 'x-360note-csrf': '1' } });
      await fetch(`/api/notes/${id}/permanent`, { method: 'DELETE', headers: { 'x-360note-csrf': '1' } });
    }, noteId).catch(() => {});
  }
  if (notificationId) await pool.query('DELETE FROM notifications WHERE id = $1', [notificationId]).catch(() => {});
  await page.evaluate(async () => {
    await fetch('/api/auth/logout', { method: 'POST', headers: { 'x-360note-csrf': '1' } });
  }).catch(() => {});
  await browser.close();
  await pool.end();
}
