CREATE TABLE IF NOT EXISTS users (
 id uuid PRIMARY KEY, email text UNIQUE NOT NULL, password_hash text NOT NULL,
 birth_date date NOT NULL, status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
 role text NOT NULL DEFAULT 'user' CHECK (role IN ('user','moderator')),
 age_verified boolean NOT NULL DEFAULT false, totp_secret text, totp_last_step bigint,
 created_at timestamptz NOT NULL DEFAULT now(), last_active_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS profiles (
 user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 display_name text NOT NULL, bio text NOT NULL DEFAULT '', city text NOT NULL,
 age_min integer NOT NULL DEFAULT 18 CHECK (age_min >= 18), age_max integer NOT NULL DEFAULT 99 CHECK (age_max >= age_min AND age_max <= 99),
 intention text NOT NULL DEFAULT 'friendship' CHECK (intention IN ('friendship','dating')),
 exploration double precision NOT NULL DEFAULT 0.5 CHECK (exploration BETWEEN 0 AND 1),
 allow_explicit boolean NOT NULL DEFAULT false, genres jsonb NOT NULL DEFAULT '[]', artists jsonb NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS sessions (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 family_id uuid NOT NULL, access_hash text UNIQUE NOT NULL, refresh_hash text UNIQUE NOT NULL,
 access_expires_at timestamptz NOT NULL, refresh_expires_at timestamptz NOT NULL,
 rotated boolean NOT NULL DEFAULT false, mfa_until timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_family_idx ON sessions(family_id);
CREATE TABLE IF NOT EXISTS consents (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 kind text NOT NULL, version text NOT NULL, granted_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz
);
CREATE TABLE IF NOT EXISTS music_catalog_items (
 id uuid PRIMARY KEY, recording_id text UNIQUE NOT NULL, title text NOT NULL, artist text NOT NULL,
 genres jsonb NOT NULL, decade text NOT NULL, explicit boolean NOT NULL DEFAULT false,
 rights_status text NOT NULL CHECK (rights_status IN ('demo','licensed')), source text NOT NULL,
 rights_reference text, link_url text, spotify_uri text, enabled boolean NOT NULL DEFAULT true
);
CREATE TABLE IF NOT EXISTS track_swipes (
 user_id uuid REFERENCES users(id) ON DELETE CASCADE, item_id uuid REFERENCES music_catalog_items(id) ON DELETE CASCADE,
 action text NOT NULL CHECK (action IN ('like','dislike','favorite','pass')),
 occurred_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,item_id)
);
CREATE TABLE IF NOT EXISTS track_swipe_history (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 item_id uuid NOT NULL REFERENCES music_catalog_items(id) ON DELETE CASCADE,
 action text NOT NULL, previous_action text, occurred_at timestamptz NOT NULL DEFAULT now(), undone boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS person_swipes (
 actor_id uuid REFERENCES users(id) ON DELETE CASCADE, target_id uuid REFERENCES users(id) ON DELETE CASCADE,
 action text NOT NULL CHECK(action IN ('like','pass')), created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(actor_id,target_id), CHECK(actor_id <> target_id)
);
CREATE TABLE IF NOT EXISTS matches (
 id uuid PRIMARY KEY, user_a uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 user_b uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','removed','blocked')),
 matched_at timestamptz NOT NULL DEFAULT now(), algorithm_version text NOT NULL,
 UNIQUE(user_a,user_b), CHECK(user_a < user_b)
);
CREATE INDEX IF NOT EXISTS matches_user_b_idx ON matches(user_b);
CREATE TABLE IF NOT EXISTS messages (
 id uuid PRIMARY KEY, match_id uuid NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
 sender_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, body_ciphertext text,
 created_at timestamptz NOT NULL DEFAULT now(), read_at timestamptz, deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS messages_match_idx ON messages(match_id,created_at,id);
CREATE TABLE IF NOT EXISTS instagram_accounts (
 user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, username_ciphertext text NOT NULL
);
CREATE TABLE IF NOT EXISTS instagram_share_consents (
 match_id uuid REFERENCES matches(id) ON DELETE CASCADE, user_id uuid REFERENCES users(id) ON DELETE CASCADE,
 granted boolean NOT NULL, decided_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(match_id,user_id)
);
CREATE TABLE IF NOT EXISTS playlist_drafts (
 id uuid PRIMARY KEY, match_id uuid NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
 algorithm_version text NOT NULL, revision integer NOT NULL DEFAULT 1,
 items jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS oauth_connections (
 user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 access_ciphertext text NOT NULL, refresh_ciphertext text NOT NULL, expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS oauth_states (
 state_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 verifier_ciphertext text NOT NULL, expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS spotify_exports (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 draft_id uuid NOT NULL REFERENCES playlist_drafts(id) ON DELETE CASCADE,
 revision integer NOT NULL, status text NOT NULL, playlist_id text, playlist_url text,
 operation_key text NOT NULL, UNIQUE(user_id,draft_id,revision)
);
CREATE TABLE IF NOT EXISTS blocks (
 blocker_id uuid REFERENCES users(id) ON DELETE CASCADE, blocked_id uuid REFERENCES users(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(blocker_id,blocked_id), CHECK(blocker_id <> blocked_id)
);
CREATE TABLE IF NOT EXISTS reports (
 id uuid PRIMARY KEY, reporter_id uuid REFERENCES users(id) ON DELETE SET NULL,
 target_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
 target_type text NOT NULL CHECK(target_type IN ('user','message','photo')),
 target_id uuid NOT NULL, category text NOT NULL, detail_ciphertext text,
 status text NOT NULL DEFAULT 'open', priority integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reports_target_idx ON reports(target_user_id,reporter_id);
CREATE TABLE IF NOT EXISTS moderation_actions (
 id uuid PRIMARY KEY, report_id uuid REFERENCES reports(id) ON DELETE CASCADE,
 actor_id uuid REFERENCES users(id) ON DELETE SET NULL, action text NOT NULL,
 note_ciphertext text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS audit_events (
 id uuid PRIMARY KEY, actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
 event_type text NOT NULL, subject_id uuid, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS idempotency_keys (
 user_id uuid REFERENCES users(id) ON DELETE CASCADE, key text NOT NULL, request_hash text NOT NULL,
 result_ciphertext text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,key)
);
CREATE TABLE IF NOT EXISTS profile_photos (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 content_ciphertext text NOT NULL, mime_type text NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS verification_events (id text PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS ws_tickets (
 ticket_hash text PRIMARY KEY, session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS feed_impressions (
 viewer_id uuid REFERENCES users(id) ON DELETE CASCADE, target_id uuid REFERENCES users(id) ON DELETE CASCADE,
 day date NOT NULL DEFAULT CURRENT_DATE, algorithm_version text NOT NULL,
 PRIMARY KEY(viewer_id,target_id,day)
);
