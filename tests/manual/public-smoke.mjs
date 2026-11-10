import { chromium } from '@playwright/test';
const browser = await chromium.launch({ headless: true });
const results = [];
for (const viewport of [{ width: 1440, height: 900, name: 'desktop' }, { width: 390, height: 844, name: 'mobile' }]) {
  const ctx = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, locale: 'zh-CN' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(`PAGE:${error.message}`));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(`CONSOLE:${message.text()}`); });
  await page.goto('https://360note.com/', { waitUntil: 'networkidle' });
  await page.screenshot({ path: `/tmp/opencode/public-${viewport.name}.png`, fullPage: false });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  const manifest = await page.evaluate(async () => {
    const response = await fetch('/manifest.webmanifest');
    const data = await response.json();
    return { name: data.name, icons: data.icons?.length, maskable: data.icons?.some((icon) => icon.purpose === 'maskable') };
  });
  await page.evaluate(async () => { await navigator.serviceWorker?.ready.catch(() => null); });
  const sw = await page.evaluate(async () => Boolean(await navigator.serviceWorker.getRegistration()));
  await page.goto('https://360note.com/login', { waitUntil: 'networkidle' });
  await page.screenshot({ path: `/tmp/opencode/login-${viewport.name}.png`, fullPage: false });
  await page.goto('https://360note.com/s/not-a-real-token', { waitUntil: 'networkidle' });
  const shareText = (await page.locator('body').innerText()).slice(0, 120);
  results.push({ viewport: viewport.name, overflow, manifest, sw, shareText, errors });
  await ctx.close();
}
await browser.close();
console.log(JSON.stringify(results, null, 2));
