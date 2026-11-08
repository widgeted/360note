# AGENTS.md — Working on 360note

You are working on 360note / 360笔记, a production note application.

- Chinese edition: `https://360biji.com`
- English edition: `https://360note.com`
- Repository: `github.com/widgeted/360note`
- Both domains share one API, one PostgreSQL database and one account system. The hostname selects the UI and email language.

## First reads

1. `README.md`
2. `docs/DESIGN_SYSTEM.md` — UI changes must follow it. The accent colour is green.
3. `docs/ARCHITECTURE.md` — data model, sync, security, backup.
4. `docs/FEATURES.md` — priority/placement. Update it when behaviour changes.
5. `docs/QUALITY.md` — tests, security checklist, release gates.
6. `docs/MEMORY.md` — current state, known bugs, decisions.
7. `docs/decisions/` — ADRs; do not silently reverse a decision.

## Hard constraints

- **Email is allowed only for account and security mail**: registration codes, password reset codes, password/email change notices, workspace invitations, and security alerts. Never send marketing mail, never buy lists, never email users who did not request it.
- **Never test email against random or non-existent addresses.** Use only an address the operator explicitly provides (recorded in the server credentials file).
- **Do not pollute the domain.** No spam, no public test pages, no third-party analytics/ads.
- **Do not lose user data.** Before destructive changes: backup, preview, preserve a copy. Never silently overwrite notes.
- **Do not weaken auth/security** (CSRF, rate limits, password hashing, email-code attempts/cooldowns, 2FA replay protection, share token hashing, path traversal checks, CSP, workspace permissions).
- **Do not commit secrets** (`/etc/360note/360note.env`, `NOTE360_MASTER_KEY`, database passwords, admin/demo passwords, user data).
- **Do not claim E2EE.** The server can read note bodies; docs and UI must say so.
- **Do not add a second visual language.** Use tokens/components in `apps/web/src/styles/`; update `DESIGN_SYSTEM.md` first if needed.
- **Never use serif/Songti/Newsreader** anywhere (UI, notes, shares, exports, error pages). Inter/system sans only.
- **No interface text below 13px** — including privacy/terms, timestamps, hints and error details.
- **No hover underline, lift, scale or active displacement.** Hover may only change colour/background/border.
- **Do not cram every feature into the main screen.** High frequency → main path; medium → context/panel; low → settings; extremely low → command palette + wizard.
- **Mobile copy must match mobile behaviour.** Do not tell phone users to drag files or use a desktop bookmarklet.
- **Push immediately.** After every code, docs or deployment change, commit and `git push` to `github.com:widgeted/360note` before considering the task done.

## Repo map

- `apps/server` — Fastify API, PostgreSQL migrations, services, routes, SMTP mailer.
- `apps/web` — React 19 + Vite PWA, TipTap, Zustand, IndexedDB.
- `packages/shared` — shared types/permissions.
- `docs` — source of truth for design/features/quality/memory.
- `deploy` — systemd/nginx/env templates.
- `scripts/provision-accounts.mjs` — creates the administrator and the demo account, then seeds demo notes.
- `tests/manual/` — manual/e2e/security checks.

## Development

```bash
npm ci
cp deploy/360note.env.example .env
npm run dev
npm run typecheck
npm run build
```

- Dev origin may be `http://localhost:5173`.
- Production origin is `https://360note.com` for generated fallback links; request-aware code keeps 360biji.com links on 360biji.com.
- Migrations run at server start; add new numbered SQL files, never edit an applied migration.
- After every web build, restart the API if you test Fastify static.

## Before you finish

- [ ] Typecheck + build pass.
- [ ] Relevant e2e/manual/security checks done.
- [ ] Security-sensitive changes reviewed against `QUALITY.md`.
- [ ] Docs updated: `CHANGELOG.md`, `MEMORY.md`, and `FEATURES.md` if behaviour changes.
- [ ] No test data/secrets left in the production database or repo.
- [ ] If deployment changed: update `OPERATIONS.md`, restart systemd, health check.
- [ ] If a decision changed: add/update an ADR.
- [ ] **Committed and pushed to GitHub immediately**; verify the remote commit is current.

## Production notes

- App: `/opt/360note`; service `360note.service`; env `/etc/360note/360note.env`; data `/var/lib/360note`.
- Node 22 at `/opt/node22/bin/node`.
- Nginx terminates TLS; Node listens on `127.0.0.1:8787`.
- Health: `https://360note.com/health` and `https://360biji.com/health`.
- Backups are encrypted at rest and downloadable; do not delete without a verified replacement.
- The first registered user is the instance admin. The provisioned administrator and demo account are operational accounts; treat their passwords as secrets.
