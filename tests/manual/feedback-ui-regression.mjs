#!/usr/bin/env node
/**
 * Feedback UI regression: editor banners keep actions and the close control on
 * the right at desktop/mobile widths, and toasts use the shared surface style.
 * Requires NH_TEST_EMAIL / NH_TEST_PASSWORD and a running API.
 */
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8787';
const EMAIL = process.env.NH_TEST_EMAIL;
const PASSWORD = process.env.NH_TEST_PASSWORD;
if (!EMAIL || !PASSWORD) throw new Error('NH_TEST_EMAIL / NH_TEST_PASSWORD are required');
const browser=await chromium.launch({headless:true});
for(const width of [1440,390]){
  const ctx=await browser.newContext({viewport:{width,height:900},locale:'zh-CN',isMobile:width===390,hasTouch:width===390,extraHTTPHeaders:{'x-forwarded-for':`198.51.100.${Math.floor(Math.random()*180)+20}`}});
  const page=await ctx.newPage();
  await page.goto(`${BASE}/login`,{waitUntil:'networkidle'});
  await page.fill('#login-email', EMAIL); await page.fill('#login-password', PASSWORD);
  await page.click('button[type=submit]'); await page.waitForURL('**/app'); await page.waitForTimeout(600);
  await page.locator('.note-item').first().click(); await page.waitForTimeout(700);
  if (width === 390) {
    const toolbar = await page.evaluate(() => {
      const bar = document.querySelector('.editor-toolbar');
      const label = bar?.querySelector('.tool-btn-text')?.textContent?.trim();
      const rows = new Set([...bar.querySelectorAll('.tool-btn')].map((el) => Math.round(el.getBoundingClientRect().top)));
      return { label, rows: rows.size, height: bar.getBoundingClientRect().height };
    });
    assert.equal(toolbar.label, '¶', 'mobile paragraph control must stay compact');
    assert.equal(toolbar.rows, 1, 'mobile toolbar controls must stay on one row');
    assert.ok(toolbar.height <= 42, `mobile toolbar should stay one row high, got ${toolbar.height}`);
  }
  await page.evaluate(()=>{
    const host=document.querySelector('.editor-shell'); if(!host) return;
    const wrap=document.createElement('div'); wrap.id='audit-banner-host'; wrap.style.padding='10px 18px 0';
    wrap.innerHTML=`<div class="banner banner-warning" style="max-width:900px;margin:0 auto"><svg viewBox="0 0 24 24" width="16" height="16"></svg><div class="banner-body">检测到冲突，本地内容已保存到版本历史。当前显示的是服务器上的版本。</div><div class="banner-actions"><button type="button" class="btn btn-secondary btn-sm">查看历史版本</button><button type="button" class="icon-btn icon-btn-sm banner-close" aria-label="关闭提示">×</button></div></div>`;
    host.insertBefore(wrap,host.children[1]);
  });
  const data=await page.evaluate(()=>{
    const b=document.querySelector('#audit-banner-host .banner'); const close=b.querySelector('.banner-close'); const btn=b.querySelector('.btn');
    const br=b.getBoundingClientRect(), cr=close.getBoundingClientRect(), rr=btn.getBoundingClientRect();
    return {banner:{l:br.left,r:br.right,t:br.top,w:br.width,b:br.bottom},close:{l:cr.left,r:cr.right,t:cr.top,b:cr.bottom},button:{l:rr.left,r:rr.right,t:rr.top,b:rr.bottom},doc:document.documentElement.scrollWidth,vw:innerWidth};
  });
  console.log(width,JSON.stringify(data));
  assert.ok(data.doc<=width+1);
  assert.ok(Math.abs(data.close.r-data.banner.r)<=16, 'close should sit at the right edge');
  assert.ok(data.button.l<data.close.l, 'action button should be left of close');
  assert.ok(data.close.t<=data.banner.t+18, 'close must stay on the banner row, not below the text');
  await page.screenshot({path:`/tmp/opencode/banner-${width}.png`});
  await page.keyboard.press('Control+s'); await page.waitForTimeout(400);
  const toast=await page.evaluate(()=>{const t=document.querySelector('.toast'); if(!t) return null; const s=getComputedStyle(t),c=t.querySelector('.toast-close'); const tr=t.getBoundingClientRect(),cr=c.getBoundingClientRect(); return {bg:s.backgroundColor,radius:s.borderRadius,border:s.borderColor,closeRight:cr.right,toastRight:tr.right,doc:document.documentElement.scrollWidth};});
  console.log('toast',toast);
  assert.ok(toast);
  assert.ok(toast.closeRight<=toast.toastRight+1);
  assert.equal(toast.radius,'8px','toasts should use the shared 8px radius');
  assert.ok(toast.bg!=='rgba(0, 0, 0, 0)','toasts should use the shared surface background');
  await page.screenshot({path:`/tmp/opencode/toast-${width}.png`});
  await ctx.close();
}
await browser.close();
