#!/usr/bin/env node
/**
 * Image delivery regression: editor/public share load a WebP thumbnail first,
 * Markdown keeps the original URL, clicking opens the original lightbox, and
 * the thumbnail is smaller than the original.
 * Requires NH_TEST_EMAIL / NH_TEST_PASSWORD and a running API.
 */
import { chromium } from '@playwright/test';
import sharp from 'sharp';
import assert from 'node:assert/strict';
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8787';
const EMAIL = process.env.NH_TEST_EMAIL;
const PASSWORD = process.env.NH_TEST_PASSWORD;
if (!EMAIL || !PASSWORD) throw new Error('NH_TEST_EMAIL / NH_TEST_PASSWORD are required');
const browser=await chromium.launch({headless:true});
const ctx=await browser.newContext({viewport:{width:1440,height:1000},locale:'zh-CN',extraHTTPHeaders:{'x-forwarded-for':'198.51.100.71'}});
const page=await ctx.newPage();
await page.goto(`${BASE}/login`,{waitUntil:'networkidle'});
await page.fill('#login-email', EMAIL); await page.fill('#login-password', PASSWORD);
await page.click('button[type=submit]'); await page.waitForURL('**/app'); await page.waitForTimeout(500);
const me=await (await page.request.get(`${BASE}/api/auth/me`)).json();
const created=await page.request.post(`${BASE}/api/notes`,{headers:{'x-360note-csrf':'1'},data:{workspaceId:me.workspaces[0].id,title:'Thumb test',contentMd:''}});
const note=(await created.json()).note;
await page.goto(`${BASE}/app/note/${note.id}`,{waitUntil:'networkidle'}); await page.waitForTimeout(800);
const photo = await sharp({ create: { width: 1200, height: 800, channels: 3, background: { r: 30, g: 120, b: 80 } } }).jpeg({ quality: 90 }).toBuffer();
await page.locator('.editor-toolbar input[type=file]').setInputFiles({ name: 'test-photo.jpg', mimeType: 'image/jpeg', buffer: photo });
await page.locator('.editor-upload').waitFor({state:'detached',timeout:15000});
const img=page.locator('.ProseMirror img').first();
await img.waitFor();
await page.waitForTimeout(1200);
const info=await img.evaluate(el=>({src:el.getAttribute('src'),orig:el.getAttribute('data-original-src'),loading:el.getAttribute('loading'),natural:[el.naturalWidth,el.naturalHeight]}));
console.log('img',info);
assert.ok(info.src.includes('thumb=1')); assert.ok(info.orig && !info.orig.includes('thumb=1')); assert.equal(info.loading,'lazy');
const thumbRes=await page.request.get(`${BASE}${info.src}`);
const origRes=await page.request.get(`${BASE}${info.orig}`);
const thumb=Buffer.from(await thumbRes.body()); const orig=Buffer.from(await origRes.body());
console.log('sizes',{thumb:thumb.length,orig:orig.length,thumbType:thumbRes.headers()['content-type']});
assert.equal(thumbRes.status(),200); assert.equal(thumbRes.headers()['content-type'],'image/webp');
assert.ok(thumb.length<orig.length,'thumbnail should be smaller');
// Click thumb opens lightbox with original.
await img.click(); await page.locator('.image-lightbox').waitFor(); await page.waitForTimeout(400);
const lightbox=await page.evaluate(()=>{const l=document.querySelector('.image-lightbox'); const i=l.querySelector('img'); return {src:i.getAttribute('src'),alt:i.getAttribute('alt'),close:!!l.querySelector('.image-lightbox-bar button'),open:l.querySelector('.image-lightbox-bar a')?.getAttribute('href')};});
console.log('lightbox',lightbox); assert.ok(lightbox.src.includes(info.orig.split('?')[0])); assert.ok(lightbox.close); assert.ok(lightbox.open);
await page.keyboard.press('Escape'); await page.locator('.image-lightbox').waitFor({state:'detached'});
// Markdown keeps original URL.
await page.waitForTimeout(900);
const saved=(await (await page.request.get(`${BASE}/api/notes/${note.id}`)).json()).note;
assert.ok(saved.contentMd.includes(info.orig),'markdown must keep original URL');
assert.ok(!saved.contentMd.includes('thumb=1'),'markdown must not store thumbnail URL');
console.log('PASS  editor shows thumbnail, original loads on click, markdown stays original');
// Public share page uses thumbnail and opens original.
const shareRes=await page.request.post(`${BASE}/api/notes/${note.id}/shares`,{headers:{'x-360note-csrf':'1'},data:{permission:'view'}});
const share=(await shareRes.json()).share;
const pub=await browser.newContext({viewport:{width:390,height:844},locale:'zh-CN',isMobile:true,hasTouch:true});
const p=await pub.newPage(); await p.goto(`${BASE}/s/${share.token}`,{waitUntil:'networkidle'}); await p.waitForTimeout(800);
const publicImg=await p.locator('.public-body img').first().evaluate(el=>({src:el.getAttribute('src'),orig:el.getAttribute('data-original-src')}));
console.log('public img',publicImg); assert.ok(publicImg.src.includes('thumb=1')); assert.ok(publicImg.orig.includes('/api/public/shares/'));
await p.locator('.public-body img').first().click(); await p.locator('.image-lightbox').waitFor();
assert.ok((await p.locator('.image-lightbox img').getAttribute('src')).includes('/attachments/'));
console.log('PASS  public share uses thumbnail and opens original on click');
await page.request.delete(`${BASE}/api/shares/${share.id}`,{headers:{'x-360note-csrf':'1'}});
await page.request.delete(`${BASE}/api/notes/${note.id}`,{headers:{'x-360note-csrf':'1'}});
await page.request.delete(`${BASE}/api/notes/${note.id}/permanent`,{headers:{'x-360note-csrf':'1'}});
await browser.close();
