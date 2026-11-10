-- Record the client IP for public guest comments so administrators can review abuse.
ALTER TABLE comments ADD COLUMN IF NOT EXISTS ip text;
