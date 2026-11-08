# ADR-001: Web-first with IndexedDB offline cache

- Status: accepted
- Date: 2026-11-07

## Context

360note must work on desktop, tablet, phone and be installable, while supporting teams, sharing, server-side search and backups. The reference projects split between full local-first SQLite (Trilium/Joplin/SilverBullet) and server-authoritative (Memos/Blinko). Full local-first on every client requires a complex sync protocol, permission model and migration story; a pure online app would fail the offline requirement.

## Decision

Use a server-authoritative PostgreSQL store and a React PWA with an IndexedDB cache:

- summaries, folders, tags after workspace load;
- full note bodies when opened/created (and later prefetched for recent notes);
- drafts on every change;
- an outbox for offline create/update;
- version-based optimistic concurrency, with 3-way merge/conflict copies on reconnect.

## Consequences

Positive: one permission model, server-side search/backup/team features, simple deployment, reliable multi-device. Negative: uncached notes are not readable offline; attachments cannot be uploaded offline; the client must implement draft/outbox/merge logic. This is documented in `FEATURES.md` and `QUALITY.md`. P1 will prefetch recent notes and queue attachments.
