CREATE TABLE IF NOT EXISTS bootcamp_account_link_flows (
  state_hash TEXT PRIMARY KEY,
  step TEXT NOT NULL CHECK (step IN ('steam', 'discord')),
  steam_id TEXT,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bootcamp_account_link_flows_expiry
  ON bootcamp_account_link_flows(expires_at);

CREATE TABLE IF NOT EXISTS bootcamp_account_link_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  discord_id TEXT NOT NULL,
  steam_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'done')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(discord_id, steam_id)
);
CREATE INDEX IF NOT EXISTS idx_bootcamp_account_link_outbox_pending
  ON bootcamp_account_link_outbox(status, next_attempt_at, id);
