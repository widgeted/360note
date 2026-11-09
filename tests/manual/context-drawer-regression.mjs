#!/usr/bin/env node
/**
 * Mobile context drawer: opens at its content width, leaves a blurred sliver
 * of the note visible on the left, and defaults to the Info tab rather than
 * auto-opening version history.
 */
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8787';
const EMAIL = process.env.NH_TEST_EMAIL;
const PASSWORD = process.env.NH_TEST_PASSWORD;
if (!EMAIL || !PASSWORD) throw new Error('NH_TEST_EMAIL / NH_TEST_PASSWORD are required');
const browser=await chromium.launch({headless:true});
const ctx=await browser.newContext({viewport:{width:390,height:844},locale:'zh-CN',isMobile:true,hasTouch:true,extraHTTPHeaders:{'x-forwarded-for':'198.51.100.81'}});
const page=await ctx.newPage();
await page.goto(`${BASE}/login`,{waitUntil:'networkidle'});
await page.fill('#login-email', EMAIL); await page.fill('#login-password', PASSWORD);
await page.click('button[type=submit]'); await page.waitForURL('**/app'); await page.waitForTimeout(600);
await page.locator('.note-item').first().click(); await page.waitForTimeout(700);
await page.getByRole('button',{name:'显示信息面板'}).click(); await page.waitForTimeout(500);
const data=await page.evaluate(()=>{const p=document.querySelector('.context-panel'),s=document.querySelector('.context-scrim'),r=p.getBoundingClientRect(); const cs=getComputedStyle(s),ps=getComputedStyle(p); return {panel:{left:r.left,right:r.right,width:r.width,radius:ps.borderRadius,shadow:ps.boxShadow,transition:ps.transitionDuration,z:ps.zIndex},vw:innerWidth,scrim:{blur:cs.backdropFilter,bg:cs.backgroundColor,z:cs.zIndex},tab:document.querySelector('.context-tab.active')?.textContent?.trim()};});
console.log(data);
assert.ok(data.panel.width<data.vw*0.9); assert.ok(data.panel.left>40); assert.equal(data.panel.radius,'0px'); assert.equal(data.panel.shadow,'none'); assert.ok(data.panel.transition.includes('0.26s')); assert.notEqual(data.scrim.blur,'none'); assert.ok(data.scrim.bg.includes('0.42')); assert.equal(data.scrim.z, String(Number(data.panel.z)-1)); assert.equal(data.tab,'信息');
await page.getByRole('button',{name:'关闭'}).click(); await page.waitForTimeout(60);
const closing=await page.evaluate(()=>{const p=document.querySelector('.context-panel'); return {transform:getComputedStyle(p).transform,visibility:getComputedStyle(p).visibility};});
await page.waitForTimeout(320);
const closed=await page.evaluate(()=>{const p=document.querySelector('.context-panel'); return {transform:getComputedStyle(p).transform,visibility:getComputedStyle(p).visibility};});
console.log('closing',closing,'closed',closed);
assert.ok(closing.transform!=='none','drawer should animate out');
assert.equal(closed.visibility,'hidden');
await page.getByRole('button',{name:'显示信息面板'}).click(); await page.waitForTimeout(400);
await page.screenshot({path:'/tmp/opencode/context-drawer-mobile.png'});
await browser.close();
