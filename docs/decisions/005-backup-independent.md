# ADR-005: Backups are independent of sync, downloadable and previewable

- Status: accepted
- Date: 2026-11-07

## Context

Sync propagates deletions and ransomware; backups must not. Reference projects often treat sync as backup or offer only vendor-hosted restore. Users must be able to verify and take data out.

## Decision

- `.3nb` ZIP: manifest + workspace.json + attachments, encrypted at rest with AES-256-GCM.
- Automatic daily per-workspace backups, retention 14 auto copies / 30 days (configurable); manual and pre-restore backups.
- Download, upload, list, delete; restore preview; merge (new copy folder) and replace (with automatic pre-restore backup).
- Separate full exports in open formats (Markdown + attachments/HTML/JSON).
- Backups exclude shares/API tokens/passwords/2FA secrets; comments restore as guest names. Trash is not included in v0.1.

## Consequences

- Users can restore at a point in time and verify counts before destructive actions.
- Backups live on the same server; offsite storage is a P1/P2 roadmap item. Users are advised to download regularly.
