-- Idempotency key for backup creation jobs.
ALTER TABLE backups ADD COLUMN IF NOT EXISTS job_id uuid REFERENCES jobs(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS backups_job_id_uidx ON backups (job_id) WHERE job_id IS NOT NULL;
