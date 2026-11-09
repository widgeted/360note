#!/usr/bin/env node
/**
 * Admin compliance regression: sharing restriction, account suspension,
 * registration IP blocks and paginated audit logs. Creates a temporary admin,
 * restores the target account, removes the temporary IP block and admin.
 */
import { chromium } from '@playwright/test';
import crypto from 'node:crypto';
import pg from 'pg';
import assert from 'node:assert/strict';
import { hashPassword } from '../../apps/server/dist/lib/passwords.js';
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8787';
const TARGET_EMAIL = process.env.NH_TEST_EMAIL;
const TARGET_PASSWORD = process.env.NH_TEST_PASSWORD;
if (!TARGET_EMAIL || !TARGET_PASSWORD) throw new Error('NH_TEST_EMAIL / NH_TEST_PASSWORD are required');
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});
const stamp=Date.now();
const adminEmail=`tmp-admin-${stamp}@invalid.local`;
const adminPassword='K9m!tR4#vQ2@2026';
const passwordHash=await hashPassword(adminPassword);
const adminId=(await pool.query("INSERT INTO users (email,display_name,password_hash,role,prefs) VALUES ($1,'Temp admin',$2,'admin','{}'::jsonb) RETURNING id",[adminEmail,passwordHash])).rows[0].id;
const browser=await chromium.launch({headless:true});
const ctx=await browser.newContext({extraHTTPHeaders:{'x-forwarded-for':'198.51.100.151'}}); const page=await ctx.newPage();
try {
 await page.goto(`${BASE}/login`,{waitUntil:'networkidle'}); await page.fill('#login-email',adminEmail); await page.fill('#login-password',adminPassword); await page.click('button[type=submit]'); await page.waitForURL('**/app'); await page.waitForTimeout(500);
 const users=(await (await page.request.get(`${BASE}/api/admin/users`)).json()).users; const demo=users.find(u=>u.email===TARGET_EMAIL); assert.ok(demo);
 assert.equal((await page.request.patch(`${BASE}/api/admin/users/${demo.id}/restrictions`,{headers:{'x-360note-csrf':'1'},data:{sharingDisabled:true}})).status(),200);
 const dctx=await browser.newContext({extraHTTPHeaders:{'x-forwarded-for':'198.51.100.152'}}); const dp=await dctx.newPage();
 await dp.goto(`${BASE}/login`,{waitUntil:'networkidle'}); await dp.fill('#login-email', TARGET_EMAIL); await dp.fill('#login-password', TARGET_PASSWORD); await dp.click('button[type=submit]'); await dp.waitForURL('**/app');
 const me=await (await dp.request.get(`${BASE}/api/auth/me`)).json(); const note=(await (await dp.request.get(`${BASE}/api/notes?workspaceId=${me.workspaces[0].id}&limit=1`)).json()).notes[0];
 assert.equal((await dp.request.post(`${BASE}/api/notes/${note.id}/shares`,{headers:{'x-360note-csrf':'1'},data:{permission:'view'}})).status(),403);
 assert.equal((await page.request.patch(`${BASE}/api/admin/users/${demo.id}/restrictions`,{headers:{'x-360note-csrf':'1'},data:{disabled:true}})).status(),200);
 const lctx=await browser.newContext({extraHTTPHeaders:{'x-forwarded-for':'198.51.100.153'}}); const lp=await lctx.newPage(); await lp.goto(`${BASE}/login`,{waitUntil:'networkidle'}); await lp.fill('#login-email', TARGET_EMAIL); await lp.fill('#login-password', TARGET_PASSWORD); await lp.click('button[type=submit]'); await lp.waitForTimeout(900); assert.match(await lp.locator('body').innerText(),/停用/);
 assert.equal((await page.request.patch(`${BASE}/api/admin/users/${demo.id}/restrictions`,{headers:{'x-360note-csrf':'1'},data:{disabled:false}})).status(),200);
 assert.equal((await page.request.patch(`${BASE}/api/admin/users/${demo.id}/restrictions`,{headers:{'x-360note-csrf':'1'},data:{sharingDisabled:false}})).status(),200);
 const ip='198.51.100.250'; const added=await page.request.post(`${BASE}/api/admin/ip-blocks`,{headers:{'x-360note-csrf':'1'},data:{ip,reason:'test'}}); assert.equal(added.status(),200,await added.text()); const block=await added.json();
 const rctx=await browser.newContext({extraHTTPHeaders:{'x-forwarded-for':ip}}); const rp=await rctx.newPage(); const reg=await rp.request.post(`${BASE}/api/auth/register`,{headers:{'x-360note-csrf':'1'},data:{email:`blocked-${stamp}@invalid.local`,displayName:'blocked',password:'K9m!tR4#vQ2@2026',emailCode:'123456'}}); assert.equal(reg.status(),403);
 assert.equal((await page.request.delete(`${BASE}/api/admin/ip-blocks/${block.id}`,{headers:{'x-360note-csrf':'1'}})).status(),200);
 const audit=await (await page.request.get(`${BASE}/api/admin/audit?limit=10&offset=0`)).json(); console.log('audit',audit.total,audit.entries.length); assert.ok(audit.total>0); assert.ok(audit.entries.length<=10);
 console.log('PASS  admin restrictions, IP block, audit pagination');
} finally {
 await pool.query('DELETE FROM users WHERE id=$1',[adminId]);
 await browser.close(); await pool.end();
}
