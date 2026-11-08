// Manual/E2E helpers. Set credentials in the environment; never commit them.
export const BASE_URL = process.env.NH_BASE_URL ?? 'https://360note.com';
export const EMAIL = process.env.NH_TEST_EMAIL ?? process.env.NH_ADMIN_EMAIL ?? '';
export const PASSWORD = process.env.NH_TEST_PASSWORD ?? process.env.NH_ADMIN_PASSWORD ?? '';

if (!EMAIL || !PASSWORD) {
  console.warn('[manual-test] NH_TEST_EMAIL / NH_TEST_PASSWORD (or NH_ADMIN_*) are not set; login steps will fail.');
}
