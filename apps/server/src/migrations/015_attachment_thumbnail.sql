ALTER TABLE attachments ADD COLUMN IF NOT EXISTS has_thumbnail boolean NOT NULL DEFAULT false;
