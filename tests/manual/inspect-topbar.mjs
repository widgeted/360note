import { chromium } from '@playwright/test';import fs from 'node:fs';
const creds=fs.readFileSync('/root/360note-admin-initial.txt','utf8'); const email=creds.match(/邮箱: (.*)/)[1].trim(); const password=creds.match(/密码: (.*)/)[1].trim();
const b=await chromium.launch({headless:true});const c=await b.newContext({viewport:{width:1440,height:980}});const p=await c.newPage();
await p.goto('https://360note.com/login',{waitUntil:'networkidle'});await p.fill('#login-email',email);await p.fill('#login-password',password);await p.click('button[type=submit]');await p.waitForTimeout(1500);await p.click('.note-item');await p.waitForTimeout(1000);
const els=await p.locator('.topbar-actions button').evaluateAll(btns=>btns.map(x=>({title:x.title,cls:x.className,html:x.outerHTML.slice(0,100)})));console.log(els);await b.close();
