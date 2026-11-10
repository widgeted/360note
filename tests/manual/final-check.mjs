import { chromium } from '@playwright/test';
const email=process.env.NH_ADMIN_EMAIL, password=process.env.NH_ADMIN_PASSWORD;
const b=await chromium.launch({headless:true}); const c=await b.newContext({viewport:{width:1440,height:980},locale:'zh-CN'}); await c.addInitScript(()=>localStorage.setItem('nh-locale','zh-CN')); const p=await c.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message)); p.on('console',m=>{if(m.type()==='error'&&!m.text().includes('401'))errs.push(m.text())});
await p.goto('https://360note.com/login',{waitUntil:'networkidle'}); await p.fill('#login-email',email); await p.fill('#login-password',password); await p.click('button[type=submit]'); await p.waitForTimeout(2000);
console.log('url',p.url()); console.log('notes', await p.locator('.note-item').count()); console.log('sidebar', (await p.locator('.workspace-switcher').innerText()).replace(/\n/g,' | '));
await p.screenshot({path:'/tmp/final-clean-app.png',fullPage:true});
await p.click('.note-item'); await p.waitForTimeout(1200); console.log('title',await p.locator('.note-title-input').inputValue());
await p.screenshot({path:'/tmp/final-clean-editor.png',fullPage:true});
// share dialog visual only
await p.click('.topbar-actions .btn-soft'); await p.waitForTimeout(600); await p.screenshot({path:'/tmp/final-share-dialog.png',fullPage:true}); console.log('share modal', await p.locator('.modal').count()); await p.keyboard.press('Escape');
// settings admin storage
await p.goto('https://360note.com/app/settings/admin',{waitUntil:'networkidle'}); await p.waitForTimeout(800); await p.getByRole('button',{name:'存储管理'}).click(); await p.waitForTimeout(700); console.log('offsite visible',(await p.locator('.settings-inner').innerText()).includes('异地备份与对象存储（S3 兼容）'));
console.log('errors',errs);
await b.close();
