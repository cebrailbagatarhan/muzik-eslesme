-- Keep historical duplicate appeals but detach all except the oldest from the suspension action
-- before enforcing one appeal per concrete moderation action.
WITH ranked AS (
  SELECT id,row_number() OVER (PARTITION BY action_id ORDER BY created_at,id) AS rn
  FROM moderation_appeals
  WHERE action_id IS NOT NULL
)
UPDATE moderation_appeals
SET action_id=NULL
WHERE id IN (SELECT id FROM ranked WHERE rn>1);

CREATE UNIQUE INDEX IF NOT EXISTS moderation_appeals_action_unique_idx
ON moderation_appeals(action_id)
WHERE action_id IS NOT NULL;
