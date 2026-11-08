import { chromium } from '@playwright/test';
import { EMAIL, PASSWORD } from './config.mjs';
const email=process.env.NH_ADMIN_EMAIL ?? process.env.NH_TEST_EMAIL ?? '';
const password=process.env.NH_ADMIN_PASSWORD ?? process.env.NH_TEST_PASSWORD ?? '';
const browser=await chromium.launch({headless:true});
const ctx=await browser.newContext({viewport:{width:1440,height:980},locale:'zh-CN'});
await ctx.addInitScript(()=>localStorage.setItem('nh-locale','zh-CN'));
const page=await ctx.newPage();
const errs=[]; page.on('pageerror',e=>errs.push('PAGE:'+e.message));
await page.goto('https://360note.com/login',{waitUntil:'networkidle'});
await page.fill('#login-email',email); await page.fill('#login-password',password); await page.click('button[type=submit]'); await page.waitForTimeout(2000);
// wait for SW + prefetch, then reload to ensure SW control
await page.waitForTimeout(4000);
await page.reload({waitUntil:'networkidle'}); await page.waitForTimeout(1500);
// create a test note
await page.click('.new-note-btn'); await page.waitForTimeout(1200);
await page.locator('.note-title-input').fill('离线测试笔记');
await page.locator('.ProseMirror').click();
await page.keyboard.type('在线写入的初始内容。');
await page.waitForTimeout(1800);
const url = page.url();
console.log('created',url);
await page.waitForTimeout(3500); // prefetch should cache this note too? bundle request may already have run before creation; open is cached anyway.
// open note is already open and cached
await ctx.setOffline(true);
await page.reload({waitUntil:'domcontentloaded',timeout:30000}).catch(e=>console.log('reload err',e.message));
await page.waitForTimeout(2500);
console.log('offline url',page.url());
console.log('offline body', (await page.locator('body').innerText()).slice(0,300));
if(await page.locator('.ProseMirror').count()){
  await page.locator('.ProseMirror').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' 离线追加内容。');
  await page.waitForTimeout(1500);
  console.log('offline banner', (await page.locator('body').innerText()).includes('离线'));
  await page.screenshot({path:'/tmp/offline-editor.png',fullPage:true});
}
await ctx.setOffline(false);
await page.waitForTimeout(5000);
console.log('after online status', await page.locator('.topbar-save').innerText().catch(()=>'n/a'));
await page.reload({waitUntil:'networkidle'}); await page.waitForTimeout(2000);
const text = await page.locator('.ProseMirror').innerText().catch(()=>'');
console.log('persisted offline append', text.includes('离线追加内容'));
console.log('errors',errs.slice(0,10));
await browser.close();
