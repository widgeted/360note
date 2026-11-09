# Manual / E2E checks

These scripts are for development and release verification, not production automation. They create data and some perform destructive tests.

Requirements:
- a running 360note (default `https://360note.com`, override `NH_BASE_URL`; many scripts still contain localhost URLs for dev)
- Playwright Chromium installed (`npx playwright install chromium`)
- credentials via environment:
  - `NH_TEST_EMAIL`, `NH_TEST_PASSWORD` for a dev/demo user
  - or `NH_ADMIN_EMAIL`, `NH_ADMIN_PASSWORD` for an admin-only check

Examples:

```bash
NH_TEST_EMAIL=test@example.com NH_TEST_PASSWORD=... node tests/manual/e2e-smoke.mjs
NH_ADMIN_EMAIL=admin@360note.com NH_ADMIN_PASSWORD=... node tests/manual/prod-smoke.mjs
```

Do **not** run `backup-test`, `ui-qa`, or destructive scripts against a production instance unless you understand the cleanup steps. Some early scripts still target `http://127.0.0.1:8787`; set them up for local testing first or adjust with `NH_BASE_URL` where supported.

## Production security audit

`security-audit.mjs` creates temporary users/workspaces directly in the database,
exercises workspace isolation, team roles, invitations, share links, attachment
access, API token scopes, CSRF, email codes and email change, then removes all
temporary data. It uses only `@invalid.local` addresses; the mailer refuses
reserved/test domains, so no SMTP message leaves the server.

```bash
sudo env NOTE360_ENV_FILE=/etc/360note/360note.env \
  BASE_URL=http://127.0.0.1:8787 \
  ADMIN_EMAIL='...' ADMIN_PASSWORD='...' \
  /opt/node22/bin/node tests/manual/security-audit.mjs
```

Expected result: `66 passed, 0 failed`.

## Concurrency and resource-limit regressions

```bash
# One commit wins, the loser gets 409; TOTP step and backup code consume once.
sudo env $(grep -v '^#' /etc/360note/360note.env | xargs) \
  BASE_URL=http://127.0.0.1:8787 \
  /opt/node22/bin/node tests/manual/concurrency-test.mjs

# Creates a throwaway database and API, then races two first registrations.
sudo env $(grep -v '^#' /etc/360note/360note.env | xargs) \
  /opt/node22/bin/node tests/manual/first-admin-test.mjs

# Creates malicious and valid ZIPs in memory; no server needed.
/opt/node22/bin/node tests/manual/backup-limits-test.mjs

# Browser cache isolation; requires demo/admin test credentials.
CACHE_TEST_DEMO_EMAIL=... CACHE_TEST_DEMO_PASSWORD=... \
CACHE_TEST_ADMIN_EMAIL=... CACHE_TEST_ADMIN_PASSWORD=... \
/opt/node22/bin/node tests/manual/cache-isolation-test.mjs
```

Expected: all checks pass; no email is sent.

## Email safety rule

- Never send test email to arbitrary, unverified or invented addresses.
- Test users must use reserved domains (`@invalid.local`, `.invalid`, `.test`).
- `sendMail` blocks reserved domains before SMTP; do not bypass this guard.
- For a real delivery check, use only `access@126.com` or an address the operator explicitly supplies.
- These rules are mandatory and apply to every manual, integration and browser test.
