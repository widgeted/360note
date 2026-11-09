#!/usr/bin/env node
/**
 * Centering regression for empty states and gate actions: list empty actions
 * (search, empty folder, mobile), empty editor actions and public share CTA.
 * Requires NH_TEST_EMAIL / NH_TEST_PASSWORD and a running API.
 */
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8787';
const EMAIL = process.env.NH_TEST_EMAIL;
const PASSWORD = process.env.NH_TEST_PASSWORD;
if (!EMAIL || !PASSWORD) throw new Error('NH_TEST_EMAIL / NH_TEST_PASSWORD are required');
const browser=await chromium.launch({headless:true});
const ctx=await browser.newContext({viewport:{width:1440,height:980},locale:'zh-CN'});
const page=await ctx.newPage();
await page.goto(`${BASE}/login`,{waitUntil:'networkidle'});
await page.fill('#login-email', EMAIL); await page.fill('#login-password', PASSWORD);
await page.click('button[type=submit]'); await page.waitForURL('**/app'); await page.waitForTimeout(900);

async function checkGroup(containerSel, groupSel, label) {
  const data = await page.evaluate(([c,g]) => {
    const cont=document.querySelector(c), group=document.querySelector(g);
    if(!cont||!group) return null;
    const cr=cont.getBoundingClientRect(), gr=group.getBoundingClientRect();
    const kids=[...group.children].map(el=>{const r=el.getBoundingClientRect(); return {left:r.left,right:r.right,width:r.width,text:el.textContent?.trim().slice(0,20)}});
    return {containerCenter:cr.left+cr.width/2, groupCenter:gr.left+gr.width/2, cr, gr, kids, groupStyle:{justify:getComputedStyle(group).justifyContent, flexWrap:getComputedStyle(group).flexWrap}};
  }, [containerSel,groupSel]);
  assert.ok(data, `${label}: missing`);
  assert.ok(Math.abs(data.containerCenter-data.groupCenter) <= 1.5, `${label}: group off by ${data.groupCenter-data.containerCenter}`);
  console.log(`PASS  ${label} centered`, JSON.stringify({...data.groupStyle, kids:data.kids.map(k=>k.text)}));
}

// Empty editor actions.
await checkGroup('.editor-empty','.editor-empty-actions','empty editor actions');

// Search empty state.
await page.fill('.list-top input','zzzz-no-result-zzzz');
await page.keyboard.press('Enter'); await page.waitForTimeout(700);
await checkGroup('.list-empty','.list-empty-actions','search empty actions');
await page.locator('.list-empty-actions button', {hasText:'新建笔记'}).waitFor();
// Clear search via button and create an empty folder.
await page.locator('.list-empty-actions button', {hasText:'清除搜索'}).click();
await page.waitForTimeout(400);
const workspaceId = await page.evaluate(()=>localStorage.getItem('nh-workspace'));
const created = await page.request.post(`${BASE}/api/folders`,{headers:{'x-360note-csrf':'1'},data:{workspaceId,name:`空文件夹-${Date.now()}`,parentId:null}});
const folder=(await created.json()).folder;
await page.reload({waitUntil:'networkidle'}); await page.waitForTimeout(900);
await page.getByText(folder.name,{exact:true}).click(); await page.waitForTimeout(700);
await checkGroup('.list-empty','.list-empty-actions','folder empty actions');
// Mobile.
await page.setViewportSize({width:390,height:844}); await page.waitForTimeout(500);
await checkGroup('.list-empty','.list-empty-actions','mobile folder empty actions');
await page.request.delete(`${BASE}/api/folders/${folder.id}`,{headers:{'x-360note-csrf':'1'}});

// Public gate CTA.
await page.goto(`${BASE}/s/this-token-does-not-exist-1234567890`,{waitUntil:'networkidle'});
const gate = await page.evaluate(()=>{const c=document.querySelector('.public-gate'), b=document.querySelector('.public-gate-cta'); if(!c||!b) return null; const cr=c.getBoundingClientRect(),br=b.getBoundingClientRect(); return {containerCenter:cr.left+cr.width/2, buttonCenter:br.left+br.width/2, display:getComputedStyle(b).display};});
assert.ok(gate);
assert.ok(Math.abs(gate.containerCenter-gate.buttonCenter)<=1.5, `public gate CTA off: ${JSON.stringify(gate)}`);
console.log('PASS  public gate CTA centered', gate);
await browser.close();
