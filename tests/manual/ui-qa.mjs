import { chromium } from '@playwright/test';
import { EMAIL, PASSWORD } from './config.mjs';
const email=process.env.NH_ADMIN_EMAIL ?? process.env.NH_TEST_EMAIL ?? '';
const password=process.env.NH_ADMIN_PASSWORD ?? process.env.NH_TEST_PASSWORD ?? '';
const browser=await chromium.launch({headless:true});
const ctx=await browser.newContext({viewport:{width:1440,height:980},locale:'zh-CN'});
await ctx.addInitScript(()=>localStorage.setItem('nh-locale','zh-CN'));
const page=await ctx.newPage(); const errs=[]; page.on('pageerror',e=>errs.push('PAGE:'+e.message)); page.on('console',m=>{if(m.type()==='error'&&!m.text().includes('401'))errs.push('CONSOLE:'+m.text())});
await page.goto('https://360note.com/login',{waitUntil:'networkidle'});
await page.fill('#login-email',email); await page.fill('#login-password',password); await page.click('button[type=submit]'); await page.waitForTimeout(2000);
// create two temp notes via API
const ws = await page.evaluate(async()=>JSON.parse(localStorage.getItem('nh-auth-cache')).workspaces[0].id);
const ids = await page.evaluate(async(ws)=>{
  const out=[];
  for(const [i,title] of ['QA 批量一','QA 批量二'].entries()){
    const r=await fetch('/api/notes',{method:'POST',headers:{'Content-Type':'application/json','X-360note-CSRF':'1'},credentials:'same-origin',body:JSON.stringify({workspaceId:ws,title,contentMd:`# ${title}\n\n批量测试 ${i}`})});
    out.push((await r.json()).note.id);
  }
  return out;
},ws);
console.log('created',ids, 'ws',ws);
await page.reload({waitUntil:'networkidle'}); await page.waitForTimeout(1500);
console.log('count heading', await page.locator('.list-heading h1').innerText());
// select mode
await page.click('.list-actions button[title="批量选择"]'); await page.waitForTimeout(400);
const items=page.locator('.note-item');
for(let i=0;i<2;i++){ await items.nth(i).click(); }
console.log('selection bar', await page.locator('.selection-bar').innerText());
await page.click('.selection-bar >> text=删除所选'); await page.waitForTimeout(1200);
console.log('after trash count', await page.locator('.list-heading h1').innerText());
// go trash and restore
await page.click('.nav-item:has-text("回收站")'); await page.waitForTimeout(1000);
await page.click('.list-actions button[title="批量选择"]'); await page.waitForTimeout(300);
await page.locator('.note-item').first().click();
await page.locator('.note-item').nth(1).click();
await page.click('.selection-bar >> text=恢复所选'); await page.waitForTimeout(1500);
console.log('trash after restore', await page.locator('.list-heading h1').innerText());
// open a note and context at 1440
await page.click('.nav-item:has-text("全部笔记")'); await page.waitForTimeout(1200);
await page.click('.note-item'); await page.waitForTimeout(900);
await page.click('.topbar-actions button[title="显示信息面板"]'); await page.waitForTimeout(700);
const pos = await page.locator('.context-panel').evaluate(el=>{const r=el.getBoundingClientRect();return {right:r.right,width:r.width,position:getComputedStyle(el).position}});
console.log('context pos',pos);
await page.screenshot({path:'/tmp/qa-context1440.png',fullPage:true});
// settings admin
await page.goto('https://360note.com/app/settings/admin',{waitUntil:'networkidle'}); await page.waitForTimeout(1000);
console.log('admin settings', (await page.locator('.settings-inner').innerText()).slice(0,300));
await page.screenshot({path:'/tmp/qa-admin.png',fullPage:true});
// settings admin storage visible
await page.goto('https://360note.com/app/settings/admin',{waitUntil:'networkidle'}); await page.waitForTimeout(900); await page.getByRole('button',{name:'存储管理'}).click(); await page.waitForTimeout(700);
console.log('offsite text', (await page.locator('.settings-inner').innerText()).includes('异地备份与对象存储（S3 兼容）'));
// cleanup temp notes
await page.evaluate(async(ids)=>{
  for(const id of ids){ await fetch(`/api/notes/${id}`,{method:'DELETE',headers:{'X-360note-CSRF':'1'},credentials:'same-origin'}); await fetch(`/api/notes/${id}/permanent`,{method:'DELETE',headers:{'X-360note-CSRF':'1'},credentials:'same-origin'}); }
},ids);
console.log('errors',errs.slice(0,20));
await browser.close();
