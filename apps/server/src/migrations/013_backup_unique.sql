-- Prevent workspace/instance backup filenames from colliding and overwriting
-- another workspace's archive. Older installations may already contain
-- duplicate references to the same overwritten file; keep the newest row for
-- each filename/storage key so the unique indexes can be created safely.
DELETE FROM backups b
USING (
  SELECT id, row_number() OVER (PARTITION BY filename ORDER BY created_at DESC, id DESC) AS rn
  FROM backups
) duplicates
WHERE b.id = duplicates.id AND duplicates.rn > 1;

DELETE FROM backups b
USING (
  SELECT id, row_number() OVER (PARTITION BY storage_key ORDER BY created_at DESC, id DESC) AS rn
  FROM backups
) duplicates
WHERE b.id = duplicates.id AND duplicates.rn > 1;

DELETE FROM instance_backups b
USING (
  SELECT id, row_number() OVER (PARTITION BY filename ORDER BY created_at DESC, id DESC) AS rn
  FROM instance_backups
) duplicates
WHERE b.id = duplicates.id AND duplicates.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS backups_filename_uidx ON backups (filename);
CREATE UNIQUE INDEX IF NOT EXISTS backups_storage_key_uidx ON backups (storage_key);
CREATE UNIQUE INDEX IF NOT EXISTS instance_backups_filename_uidx ON instance_backups (filename);
