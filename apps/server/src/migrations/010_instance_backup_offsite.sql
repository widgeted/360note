-- Track whether an instance backup was copied to object storage.
ALTER TABLE instance_backups ADD COLUMN IF NOT EXISTS offsite_status text NOT NULL DEFAULT 'skipped';
ALTER TABLE instance_backups ADD COLUMN IF NOT EXISTS offsite_error text;
