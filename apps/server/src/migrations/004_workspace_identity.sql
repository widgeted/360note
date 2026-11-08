-- Workspace identity: a short symbol (emoji or character) and a background colour.
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS icon text NOT NULL DEFAULT '📝';
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS color text NOT NULL DEFAULT '#17865b';

UPDATE workspaces
SET icon = CASE WHEN kind = 'team' THEN '👥' ELSE '📔' END
WHERE icon = '📝';
