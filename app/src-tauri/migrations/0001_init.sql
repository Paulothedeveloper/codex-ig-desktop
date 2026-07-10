-- Codex IG Desktop — schema local (SQLite). Dados do proprio usuario, no aparelho.
-- Ver spec §5. Zero PII sai daqui.

CREATE TABLE IF NOT EXISTS account (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ig_user_id    TEXT NOT NULL UNIQUE,
  username      TEXT NOT NULL,
  added_at      INTEGER NOT NULL
);

-- snapshot: contagens pro grafico de crescimento + os JSON de pks pro diff quem-saiu/chegou
CREATE TABLE IF NOT EXISTS snapshot (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id        INTEGER NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  ts                INTEGER NOT NULL,
  following_count   INTEGER NOT NULL,
  followers_count   INTEGER NOT NULL,
  followers_json    TEXT,
  following_json    TEXT
);
CREATE INDEX IF NOT EXISTS idx_snapshot_acct_ts ON snapshot(account_id, ts);

-- whitelist: contas protegidas (nunca dar unfollow)
CREATE TABLE IF NOT EXISTS whitelist (
  account_id  INTEGER NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  pk          TEXT NOT NULL,
  username    TEXT,
  PRIMARY KEY (account_id, pk)
);

-- auditoria das acoes de escrita (unfollow)
CREATE TABLE IF NOT EXISTS unfollow_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id  INTEGER NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  pk          TEXT NOT NULL,
  username    TEXT,
  ts          INTEGER NOT NULL,
  result      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_unfollow_acct ON unfollow_log(account_id, ts);

-- cache do feed proprio pro Relatorio (likes/coments/views publicos)
CREATE TABLE IF NOT EXISTS post_metric (
  account_id  INTEGER NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  code        TEXT NOT NULL,
  taken_at    INTEGER,
  likes       INTEGER,
  comments    INTEGER,
  views       INTEGER,
  caption     TEXT,
  fetched_at  INTEGER NOT NULL,
  PRIMARY KEY (account_id, code)
);

-- espelho local opcional dos links do tracker
CREATE TABLE IF NOT EXISTS tracker_link (
  account_id  INTEGER NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  slug        TEXT NOT NULL,
  url         TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (account_id, slug)
);
