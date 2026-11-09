#!/usr/bin/env node
/**
 * Mobile editor toolbar: all format controls live in one horizontally
 * scrollable row (no hidden “more” menu), 34px touch targets, and the final
 * clear-formatting control is red.
 */
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8787';
const EMAIL = process.env.NH_TEST_EMAIL;
const PASSWORD = process.env.NH_TEST_PASSWORD;
if (!EMAIL || !PASSWORD) throw new Error('NH_TEST_EMAIL / NH_TEST_PASSWORD are required');
const browser=await chromium.launch({headless:true});
const ctx=await browser.newContext({viewport:{width:390,height:844},locale:'en-US',isMobile:true,hasTouch:true,extraHTTPHeaders:{'x-forwarded-for':'198.51.100.94'}});
const page=await ctx.newPage();
await page.goto(`${BASE}/login`,{waitUntil:'networkidle'});
await page.fill('#login-email', EMAIL); await page.fill('#login-password', PASSWORD);
await page.click('button[type=submit]'); await page.waitForURL('**/app'); await page.waitForTimeout(500);
await page.locator('.note-item').first().click(); await page.waitForTimeout(700);
const data=await page.evaluate(()=>{const bar=document.querySelector('.editor-toolbar'); const buttons=[...bar.querySelectorAll('.tool-btn')]; const tops=new Set(buttons.map(el=>Math.round(el.getBoundingClientRect().top))); const last=buttons.at(-1); const s=getComputedStyle(last); return {count:buttons.length,rows:tops.size,scrollWidth:bar.scrollWidth,clientWidth:bar.clientWidth,overflow:getComputedStyle(bar).overflowX,lastLabel:last.getAttribute('title'),lastColor:s.color,lastBg:s.backgroundColor,hasMore:[...buttons].some(el=>el.getAttribute('aria-label')==='更多格式'),lastText:last.textContent.trim(),buttonSize:[buttons[0].getBoundingClientRect().width,buttons[0].getBoundingClientRect().height]};});
console.log(data);
assert.equal(data.rows,1); assert.ok(data.scrollWidth>data.clientWidth); assert.equal(data.hasMore,false); assert.ok(data.lastLabel?.length); assert.match(data.lastColor,/rgb\(194, 61, 78\)/); assert.ok(data.buttonSize[0]>=34);
await page.locator('.editor-toolbar').evaluate(el=>el.scrollLeft=el.scrollWidth); await page.waitForTimeout(300);
await page.screenshot({path:'/tmp/opencode/toolbar-scroll-end.png'});
await browser.close();
