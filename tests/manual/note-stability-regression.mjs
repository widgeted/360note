#!/usr/bin/env node
/**
 * Note stability regression: favorite/pin/folder/tag metadata changes must not
 * consume a document version; editing afterwards saves without conflict or a
 * spurious remote-device banner.
 * Requires NH_TEST_EMAIL / NH_TEST_PASSWORD and a running API.
 */
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8787';
const EMAIL = process.env.NH_TEST_EMAIL;
const PASSWORD = process.env.NH_TEST_PASSWORD;
if (!EMAIL || !PASSWORD) throw new Error('NH_TEST_EMAIL / NH_TEST_PASSWORD are required');
const browser=await chromium.launch({headless:true});
const ctx=await browser.newContext({viewport:{width:1440,height:900},locale:'zh-CN',extraHTTPHeaders:{'x-forwarded-for':'198.51.100.111'}});
const page=await ctx.newPage();
await page.goto(`${BASE}/login`,{waitUntil:'networkidle'});
await page.fill('#login-email', EMAIL); await page.fill('#login-password', PASSWORD);
await page.click('button[type=submit]'); await page.waitForURL('**/app'); await page.waitForTimeout(500);
const me=await (await page.request.get(`${BASE}/api/auth/me`)).json();
const workspace=me.workspaces[0];
const created=await page.request.post(`${BASE}/api/notes`,{headers:{'x-360note-csrf':'1'},data:{workspaceId:workspace.id,title:'Stability check',contentMd:'body'}});
const note=(await created.json()).note;
const fav=await page.request.patch(`${BASE}/api/notes/${note.id}`,{headers:{'x-360note-csrf':'1'},data:{isFavorite:true}});
assert.equal(fav.status(),200,await fav.text());
const afterFav=(await fav.json()).note; console.log('versions',note.version,afterFav.version); assert.equal(afterFav.version,note.version);
const pin=await page.request.patch(`${BASE}/api/notes/${note.id}`,{headers:{'x-360note-csrf':'1'},data:{isPinned:true}});
const afterPin=(await pin.json()).note; assert.equal(afterPin.version,note.version);
const title=await page.request.patch(`${BASE}/api/notes/${note.id}`,{headers:{'x-360note-csrf':'1'},data:{title:'Stability check renamed',baseVersion:note.version}});
assert.equal(title.status(),200,await title.text()); assert.equal((await title.json()).note.version,note.version+1);
console.log('PASS  metadata changes do not consume document versions');
// UI: pin while editing, then save without conflict banner.
await page.goto(`${BASE}/app/note/${note.id}`,{waitUntil:'networkidle'}); await page.waitForTimeout(700);
await page.locator('.editor-topbar button[aria-label="置顶"], .editor-topbar button[aria-label="取消置顶"]').count();
await page.locator('.editor-topbar button[aria-label="收藏"], .editor-topbar button[aria-label="取消收藏"]').first().click().catch(()=>{});
await page.locator('.ProseMirror').click(); await page.keyboard.type(' edited locally');
await page.waitForTimeout(1400);
assert.equal(await page.locator('.banner').filter({hasText:'冲突'}).count(),0,'no conflict after metadata+edit');
assert.equal(await page.locator('.banner').filter({hasText:'其他设备'}).count(),0,'no remote banner');
const saved=await (await page.request.get(`${BASE}/api/notes/${note.id}`)).json();
console.log('saved excerpt',saved.note.excerpt); assert.match(saved.note.contentMd,/edited locally/);
console.log('PASS  editing after metadata change saves without conflict or remote banner');
await page.request.delete(`${BASE}/api/notes/${note.id}`,{headers:{'x-360note-csrf':'1'}});
await page.request.delete(`${BASE}/api/notes/${note.id}/permanent`,{headers:{'x-360note-csrf':'1'}});
await browser.close();
