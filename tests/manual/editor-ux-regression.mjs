#!/usr/bin/env node
/**
 * Editor UX regression:
 * - new notes open with an empty, focused title and a timestamped fallback;
 * - image upload shows an inline progress placeholder, inserts the image and
 *   never persists placeholder text;
 * - failed uploads stay inline with the reason plus retry/remove actions.
 *
 * Requires NH_TEST_EMAIL / NH_TEST_PASSWORD and a running API.
 */
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8787';
const EMAIL = process.env.NH_TEST_EMAIL;
const PASSWORD = process.env.NH_TEST_PASSWORD;
if (!EMAIL || !PASSWORD) throw new Error('NH_TEST_EMAIL / NH_TEST_PASSWORD are required');

const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z0uQAAAAASUVORK5CYII=',
  'base64',
);
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN', extraHTTPHeaders: { 'x-forwarded-for': `198.51.100.${Math.floor(Math.random() * 180) + 20}` } });
const page = await context.newPage();
let noteId = null;

try {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.fill('#login-email', EMAIL);
  await page.fill('#login-password', PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForURL('**/app');
  await page.waitForTimeout(600);

  await page.locator('.new-note-btn').click();
  await page.waitForURL(/\/app\/note\/[0-9a-f-]+$/);
  await page.waitForTimeout(700);
  noteId = page.url().split('/').pop();

  const title = page.locator('.note-title-input');
  assert.equal(await title.inputValue(), '', 'new note title field must start empty');
  assert.match(await title.getAttribute('placeholder'), /未命名笔记 \d{14}/);
  assert.equal(await title.evaluate((element) => document.activeElement === element), true, 'title must be focused');
  const created = await (await page.request.get(`${BASE}/api/notes/${noteId}`)).json();
  assert.match(created.note.title, /未命名笔记 \d{14}/, 'server keeps a timestamped fallback title');
  console.log('PASS  new notes start with an empty focused title and timestamped fallback');

  await page.route('**/api/notes/*/attachments', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 700));
    await route.continue();
  });
  await page.locator('.editor-toolbar input[type=file]').setInputFiles({ name: 'pixel.png', mimeType: 'image/png', buffer: PIXEL });
  const placeholder = page.locator('.editor-upload');
  await placeholder.waitFor({ timeout: 3000 });
  assert.ok(await placeholder.locator('.editor-upload-track').count(), 'upload placeholder exposes a progress bar');
  await placeholder.waitFor({ state: 'detached', timeout: 15000 });
  await page.locator('.ProseMirror img[src*="/api/attachments/"]').waitFor({ timeout: 5000 });
  await page.waitForTimeout(1000);
  const saved = await (await page.request.get(`${BASE}/api/notes/${noteId}`)).json();
  assert.match(saved.note.contentMd, /\/api\/attachments\//, 'uploaded image is saved in the note');
  assert.doesNotMatch(saved.note.contentMd, /data-upload-placeholder|正在上传/, 'placeholder must not leak into content');
  console.log('PASS  inline upload progress inserts the image without persisting placeholder text');

  await page.unroute('**/api/notes/*/attachments');
  await page.route('**/api/notes/*/attachments', (route) => route.abort());
  await page.locator('.editor-toolbar input[type=file]').setInputFiles({ name: 'pixel.png', mimeType: 'image/png', buffer: PIXEL });
  const failed = page.locator('.editor-upload.is-error');
  await failed.waitFor({ timeout: 8000 });
  assert.ok(await failed.locator('[data-upload-retry]').count(), 'failure offers retry');
  assert.ok(await failed.locator('[data-upload-remove]').count(), 'failure offers remove');
  assert.match(await failed.innerText(), /网络错误|上传失败/);
  console.log('PASS  failed uploads stay inline with a reason and recovery actions');
} finally {
  if (noteId) {
    await page.request.delete(`${BASE}/api/notes/${noteId}`, { headers: { 'x-360note-csrf': '1' } }).catch(() => {});
    await page.request.delete(`${BASE}/api/notes/${noteId}/permanent`, { headers: { 'x-360note-csrf': '1' } }).catch(() => {});
  }
  await browser.close();
}
