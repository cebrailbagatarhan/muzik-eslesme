ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended_until timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS suspension_reason_ciphertext text;

-- Existing accounts predate e-mail verification support; keep them usable after migration.
UPDATE users SET email_verified=true WHERE email_verified=false;

CREATE TABLE IF NOT EXISTS auth_action_tokens (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('email_verify','password_reset')),
  token_hash text UNIQUE NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS auth_action_tokens_user_idx ON auth_action_tokens(user_id,purpose,created_at DESC);
CREATE INDEX IF NOT EXISTS auth_action_tokens_expiry_idx ON auth_action_tokens(expires_at) WHERE used_at IS NULL;

-- Only one currently granted consent of a given kind may exist per user.
CREATE UNIQUE INDEX IF NOT EXISTS consents_active_kind_idx ON consents(user_id,kind) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS moderation_appeals (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action_id uuid REFERENCES moderation_actions(id) ON DELETE SET NULL,
  body_ciphertext text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','accepted','rejected')),
  reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  review_note_ciphertext text,
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz
);
CREATE INDEX IF NOT EXISTS moderation_appeals_queue_idx ON moderation_appeals(status,created_at);
CREATE INDEX IF NOT EXISTS moderation_appeals_user_idx ON moderation_appeals(user_id,created_at DESC);
