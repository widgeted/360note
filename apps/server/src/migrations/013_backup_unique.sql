-- Prevent workspace/instance backup filenames from colliding and overwriting
-- another workspace's archive.
CREATE UNIQUE INDEX IF NOT EXISTS backups_filename_uidx ON backups (filename);
CREATE UNIQUE INDEX IF NOT EXISTS backups_storage_key_uidx ON backups (storage_key);
CREATE UNIQUE INDEX IF NOT EXISTS instance_backups_filename_uidx ON instance_backups (filename);
