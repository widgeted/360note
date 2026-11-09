#!/usr/bin/env node
/**
 * Mobile share-dialog layout regression: the existing-share card must keep a
 * readable icon, stack created/expiry/views metadata, keep actions on their own
 * row, and never overflow the viewport.
 *
 * Requires NH_TEST_EMAIL / NH_TEST_PASSWORD and a running API.
 */
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8787';
const EMAIL = process.env.NH_TEST_EMAIL;
const PASSWORD = process.env.NH_TEST_PASSWORD;
if (!EMAIL || !PASSWORD) throw new Error('NH_TEST_EMAIL / NH_TEST_PASSWORD are required');

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-CN', isMobile: true, hasTouch: true });
const page = await ctx.newPage();
let createdShare = null;
let noteId = null;

try {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.fill('#login-email', EMAIL);
  await page.fill('#login-password', PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForURL('**/app');
  await page.waitForTimeout(700);

  const me = await (await page.request.get(`${BASE}/api/auth/me`)).json();
  const workspace = me.workspaces[0];
  const notes = (await (await page.request.get(`${BASE}/api/notes?workspaceId=${workspace.id}&limit=20`)).json()).notes;
  assert.ok(notes.length, 'need at least one note');

  // Reuse an existing link when available; otherwise create one and remove it later.
  for (const note of notes) {
    const shares = (await (await page.request.get(`${BASE}/api/notes/${note.id}/shares`)).json()).shares ?? [];
    if (shares.some((share) => !share.revokedAt)) {
      noteId = note.id;
      break;
    }
  }
  if (!noteId) {
    noteId = notes[0].id;
    const created = await page.request.post(`${BASE}/api/notes/${noteId}/shares`, {
      headers: { 'x-360note-csrf': '1' },
      data: { permission: 'view' },
    });
    assert.equal(created.status(), 200, await created.text());
    createdShare = (await created.json()).share;
  }

  await page.goto(`${BASE}/app/note/${noteId}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  await page.locator('.editor-topbar').getByRole('button', { name: '更多操作' }).click();
  await page.getByText('分享笔记', { exact: true }).click();
  await page.locator('.share-item').first().waitFor();
  await page.waitForTimeout(600);

  const metrics = await page.evaluate(() => {
    const item = document.querySelector('.share-item');
    const icon = item.querySelector('.share-item-icon');
    const meta = item.querySelector('.share-item-meta');
    const actions = item.querySelector('.share-item-actions');
    const ir = item.getBoundingClientRect();
    const ar = actions?.getBoundingClientRect();
    const mr = meta.getBoundingClientRect();
    return {
      viewport: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      item: { width: ir.width, scrollWidth: item.scrollWidth, clientWidth: item.clientWidth },
      icon: { width: icon.getBoundingClientRect().width, height: icon.getBoundingClientRect().height },
      metaLines: [...meta.children].map((el) => {
        const r = el.getBoundingClientRect();
        return { top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height) };
      }),
      actions: ar ? { top: Math.round(ar.top), bottom: Math.round(ar.bottom), width: Math.round(ar.width) } : null,
      metaBottom: Math.round(mr.bottom),
    };
  });

  assert.ok(metrics.documentWidth <= metrics.viewport + 1, 'share dialog must not cause horizontal overflow');
  assert.ok(metrics.item.scrollWidth <= metrics.item.clientWidth + 2, 'share card content must fit');
  assert.ok(metrics.icon.width >= 30 && metrics.icon.height >= 30, 'link icon must be at least 30px');
  assert.equal(metrics.metaLines.length, 3, 'created, expiry and views must be separate rows');
  assert.ok(metrics.metaLines[1].top >= metrics.metaLines[0].bottom - 1, 'metadata rows must stack');
  assert.ok(metrics.metaLines[2].top >= metrics.metaLines[1].bottom - 1, 'metadata rows must stack');
  if (metrics.actions) {
    assert.ok(metrics.actions.top >= metrics.metaBottom - 1, 'actions must sit below the metadata on mobile');
    assert.ok(metrics.actions.width > metrics.item.width * 0.8, 'actions row should use the full card width');
  }

  console.log('PASS  mobile share card: 30px link icon, stacked metadata and full-width action row');
} finally {
  if (createdShare) {
    await page.request.delete(`${BASE}/api/shares/${createdShare.id}`, { headers: { 'x-360note-csrf': '1' } }).catch(() => {});
  }
  await browser.close();
}
