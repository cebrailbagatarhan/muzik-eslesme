ALTER TABLE spotify_exports ADD COLUMN IF NOT EXISTS uris jsonb NOT NULL DEFAULT '[]';
ALTER TABLE spotify_exports ADD COLUMN IF NOT EXISTS retry_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE spotify_exports ADD COLUMN IF NOT EXISTS locked_until timestamptz;
ALTER TABLE spotify_exports ADD COLUMN IF NOT EXISTS last_error text;
CREATE INDEX IF NOT EXISTS spotify_queue_idx ON spotify_exports(retry_at) WHERE status='queued';
