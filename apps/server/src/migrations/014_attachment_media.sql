-- Bitiful/CoreIX media derivatives and cached image analysis for shared images.
ALTER TABLE attachments
  ADD COLUMN IF NOT EXISTS media_key text,
  ADD COLUMN IF NOT EXISTS image_tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS media_analyzed_at timestamptz;

CREATE INDEX IF NOT EXISTS attachments_media_key_idx ON attachments (media_key) WHERE media_key IS NOT NULL;
