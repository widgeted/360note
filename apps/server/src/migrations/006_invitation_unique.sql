-- One pending invitation per workspace/email; prevents parallel duplicate sends.
WITH ranked AS (
  SELECT id, row_number() OVER (
    PARTITION BY workspace_id, lower(email)
    ORDER BY created_at DESC, id DESC
  ) AS rn
  FROM workspace_invitations
  WHERE status = 'pending'
)
UPDATE workspace_invitations
SET status = 'revoked'
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

CREATE UNIQUE INDEX IF NOT EXISTS invitations_pending_email_uidx
  ON workspace_invitations (workspace_id, lower(email))
  WHERE status = 'pending';
