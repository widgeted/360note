# ADR-008: Offsite backups and attachments via S3-compatible object storage

- Status: accepted
- Date: 2026-11-08

## Context

Backups stored on the same server do not protect against server loss or ransomware with root access. The product needs an optional offsite copy without adding a vendor-specific backup service. Supporting every provider would add complexity; S3-compatible storage covers AWS S3, MinIO, Cloudflare R2, Backblaze B2 and many NAS gateways.

## Decision

- Admin configures endpoint, region, bucket, prefix, access key id and encrypted secret in Settings → Data & backups → Offsite.
- The same connection can optionally store attachments. Attachment rows keep a `storage_key`; local keys are relative paths, remote keys are `s3:attachments/<relative>`. Reads route per row, so the public URL never changes.
- Every backup (auto/manual/pre-restore) is already encrypted at rest with the 360note master key; the same encrypted `.3nb` bytes are uploaded via `PutObject` to `bucket/prefix/filename`.
- Backup list shows `offsite: uploaded|failed`; retention/deletion also deletes the remote object.
- Connection test uses `ListObjectsV2`.
- Full-site backups upload automatically when backup copies are enabled; the archive also includes attachments that exist only in object storage.
- Enabling attachment storage migrates local files first (skip when path/name/size already match), then switches new uploads. Disabling downloads and verifies every attachment before switching back; remote purge is optional.
- No in-app remote listing/direct workspace restore: download the object from the provider and use “Upload backup file”.
- Credentials are stored encrypted with `NOTE360_MASTER_KEY`; the secret is never returned to the client.
- Connection identity changes are blocked while any attachment is remote, preventing broken links.

## Consequences

- A lost server can be recovered if the master key and the offsite object are preserved.
- Operators must configure provider permissions (put/delete/list), lifecycle rules and a private bucket.
- Offsite copies are outside the app's retention UI; provider lifecycle policy should align.
- No additional vendor lock-in: any S3-compatible endpoint works.
- Local copies are retained after enabling as a safety net; deleting an attachment removes both local and remote copies.
- Migration state is in-process; after a restart, re-run the migration. Per-row routing keeps attachments readable in the meantime.
