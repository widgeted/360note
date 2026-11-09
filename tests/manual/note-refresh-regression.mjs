#!/usr/bin/env node
/**
 * Reopening a note from the list must fetch the latest server body even when
 * the store still holds that note id from the previous visit.
 * Requires NH_TEST_EMAIL / NH_TEST_PASSWORD and a running API.
 */
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8787';
const EMAIL = process.env.NH_TEST_EMAIL;
const PASSWORD = process.env.NH_TEST_PASSWORD;
if (!EMAIL || !PASSWORD) throw new Error('NH_TEST_EMAIL / NH_TEST_PASSWORD are required');

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  locale: 'zh-CN',
  isMobile: true,
  hasTouch: true,
  extraHTTPHeaders: { 'x-forwarded-for': `198.51.100.${Math.floor(Math.random() * 180) + 20}` },
});
const page = await context.newPage();
let noteId = null;

try {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.fill('#login-email', EMAIL);
  await page.fill('#login-password', PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForURL('**/app');
  await page.waitForTimeout(600);

  const me = await (await page.request.get(`${BASE}/api/auth/me`)).json();
  const workspace = me.workspaces[0];
  const stamp = Date.now();
  const title = `Refresh check ${stamp}`;
  const created = await page.request.post(`${BASE}/api/notes`, {
    headers: { 'x-360note-csrf': '1' },
    data: { workspaceId: workspace.id, title, contentMd: 'old body' },
  });
  assert.equal(created.status(), 200, await created.text());
  const note = (await created.json()).note;
  noteId = note.id;

  await page.goto(`${BASE}/app/note/${noteId}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  assert.match(await page.locator('.ProseMirror').innerText(), /old body/);

  const latest = await (await page.request.get(`${BASE}/api/notes/${noteId}`)).json();
  const updated = await page.request.patch(`${BASE}/api/notes/${noteId}`, {
    headers: { 'x-360note-csrf': '1' },
    data: { title, contentMd: `fresh body ${stamp}`, baseVersion: latest.note.version },
  });
  assert.equal(updated.status(), 200, await updated.text());

  await page.goto(`${BASE}/app`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await page.getByText(title, { exact: true }).first().click();
  await page.waitForURL(`**/app/note/${noteId}`);
  await page.waitForTimeout(900);
  assert.match(await page.locator('.ProseMirror').innerText(), new RegExp(`fresh body ${stamp}`));
  console.log('PASS  reopening a note refreshes the editor body from the server');
} finally {
  if (noteId) {
    await page.request.delete(`${BASE}/api/notes/${noteId}`, { headers: { 'x-360note-csrf': '1' } }).catch(() => {});
    await page.request.delete(`${BASE}/api/notes/${noteId}/permanent`, { headers: { 'x-360note-csrf': '1' } }).catch(() => {});
  }
  await browser.close();
}
