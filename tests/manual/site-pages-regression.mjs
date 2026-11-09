#!/usr/bin/env node
/**
 * Site-page consistency: primary link-buttons keep readable text on hover;
 * /about and legal pages share the main site header/footer; /about.html
 * redirects; public contact email is contact@360note.com.
 */
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8787';
const browser=await chromium.launch({headless:true});
// Hover color
{
 const ctx=await browser.newContext({viewport:{width:1440,height:900},locale:'en-US'});
 const page=await ctx.newPage(); await page.goto(BASE+'/',{waitUntil:'networkidle'});
 const cta=page.locator('.landing-cta a.btn-primary').first();
 const before=await cta.evaluate(el=>getComputedStyle(el).color);
 await cta.hover(); await page.waitForTimeout(300);
 const after=await cta.evaluate(el=>getComputedStyle(el).color);
 const bg=await cta.evaluate(el=>getComputedStyle(el).backgroundColor);
 console.log('hover',{before,after,bg}); assert.equal(after,'rgb(255, 255, 255)'); assert.notEqual(bg,'rgb(255, 255, 255)');
 await ctx.close();
}
for(const width of [1440,390]){
 const ctx=await browser.newContext({viewport:{width,height:900},locale:'zh-CN',isMobile:width===390,hasTouch:width===390});
 const page=await ctx.newPage();
 await page.goto(BASE+'/about',{waitUntil:'networkidle'}); await page.waitForTimeout(300);
 assert.equal(await page.locator('.landing-nav').count(),1); assert.equal(await page.locator('.legal-nav').count(),0);
 assert.equal(await page.locator('.landing-footer').count(),1);
 const mail=await page.locator('a[href="mailto:contact@360note.com"]').count(); assert.ok(mail>0);
 assert.equal(await page.getByText('noreply@360note.com').count(),0);
 await page.screenshot({path:`/tmp/opencode/about-${width}.png`,fullPage:false});
 await page.goto(BASE+'/privacy',{waitUntil:'networkidle'}); await page.waitForTimeout(300);
 assert.equal(await page.locator('.landing-nav').count(),1); assert.equal(await page.locator('.landing-footer').count(),1);
 await page.screenshot({path:`/tmp/opencode/privacy-${width}.png`,fullPage:false});
 await ctx.close();
}
// old about.html redirects
{
 const ctx=await browser.newContext({viewport:{width:1200,height:800}}); const page=await ctx.newPage();
 await page.goto(BASE+'/about.html',{waitUntil:'networkidle'}); await page.waitForTimeout(500);
 console.log('about.html url',page.url()); assert.ok(page.url().endsWith('/about'));
 await ctx.close();
}
await browser.close();
