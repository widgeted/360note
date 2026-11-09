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
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-CN', isMobile: true, hasTouch: true, extraHTTPHeaders: { 'x-forwarded-for': `198.51.100.${Math.floor(Math.random() * 180) + 20}` } });
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
    const item = [...document.querySelectorAll('.share-item')].find((element) => !element.classList.contains('is-revoked'));
    const url = item.querySelector('.share-item-url');
    const top = item.querySelector('.share-item-top');
    const meta = item.querySelector('.share-item-meta');
    const actions = item.querySelector('.share-item-actions');
    const tags = meta.querySelector('.share-item-meta-tags');
    const ir = item.getBoundingClientRect();
    const ur = url.getBoundingClientRect();
    const ar = actions?.getBoundingClientRect();
    const mr = meta.getBoundingClientRect();
    return {
      viewport: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      item: { width: ir.width, right: ir.right, scrollWidth: item.scrollWidth, clientWidth: item.clientWidth },
      url: { text: url.textContent, href: url.getAttribute('href'), width: ur.width, top: ur.top, fontSize: getComputedStyle(url).fontSize },
      urlIsFirst: item.firstElementChild === top && top.firstElementChild === url,
      actionCount: actions?.querySelectorAll('button').length ?? 0,
      actions: ar ? { top: Math.round(ar.top), bottom: Math.round(ar.bottom), width: Math.round(ar.width), right: ar.right } : null,
      metaLines: [...meta.children].map((el) => {
        const r = el.getBoundingClientRect();
        return { top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height), isTags: el === tags };
      }),
      inlineMeta: [...(meta.querySelector('.share-item-meta-line')?.children ?? [])].map((el) => {
        const r = el.getBoundingClientRect();
        return { top: Math.round(r.top), height: Math.round(r.height) };
      }),
      metaTop: Math.round(mr.top),
      metaBottom: Math.round(mr.bottom),
    };
  });

  assert.ok(metrics.documentWidth <= metrics.viewport + 1, 'share dialog must not cause horizontal overflow');
  assert.ok(metrics.item.scrollWidth <= metrics.item.clientWidth + 2, 'share card content must fit');
  assert.equal(metrics.urlIsFirst, true, 'the share URL must be the first, primary element');
  assert.match(metrics.url.text, /^https?:\/\//, 'share URL must be visible as text');
  assert.ok(metrics.url.href && metrics.url.width > 80, 'share URL must be a usable link');
  assert.equal(metrics.url.fontSize, '13.5px');
  assert.equal(metrics.actionCount, 2, 'copy and delete actions must be present');
  assert.ok(metrics.actions && metrics.actions.right <= metrics.item.right + 1, 'actions must sit on the right');
  assert.ok(metrics.actions.top < metrics.metaTop, 'actions must align with the URL row, above metadata');
  assert.equal(metrics.metaLines.length, 3, 'permission, created and expiry/views lines must be separate');
  assert.equal(metrics.inlineMeta.length, 2, 'expiry and views must share a row');
  assert.equal(metrics.inlineMeta[0].top, metrics.inlineMeta[1].top, 'expiry and views must align on one row');

  console.log('PASS  mobile share card: URL first, metadata below, copy/delete on the right');
} finally {
  if (createdShare) {
    await page.request.delete(`${BASE}/api/shares/${createdShare.id}`, { headers: { 'x-360note-csrf': '1' } }).catch(() => {});
  }
  await browser.close();
}
