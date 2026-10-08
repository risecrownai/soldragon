CREATE TABLE users (
  id         TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);

CREATE TABLE nonces (
  nonce      TEXT PRIMARY KEY,
  address    TEXT NOT NULL,
  message    TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_nonces_address ON nonces(address);

CREATE TABLE sutras (
  id         TEXT PRIMARY KEY,
  owner_id   TEXT NOT NULL REFERENCES users(id),
  title      TEXT NOT NULL,
  lang       TEXT NOT NULL,
  paragraphs TEXT NOT NULL,
  is_public  INTEGER NOT NULL DEFAULT 0 CHECK (is_public IN (0,1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_sutras_owner  ON sutras(owner_id);
CREATE INDEX idx_sutras_public ON sutras(is_public, updated_at DESC);

CREATE TABLE reactions (
  sutra_id   TEXT NOT NULL,
  user_id    TEXT NOT NULL REFERENCES users(id),
  vote       INTEGER NOT NULL DEFAULT 0 CHECK (vote IN (-1,0,1)),
  score      INTEGER CHECK (score IS NULL OR (score BETWEEN 1 AND 5)),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (sutra_id, user_id)
);

CREATE TABLE comments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  sutra_id   TEXT NOT NULL,
  user_id    TEXT NOT NULL REFERENCES users(id),
  body       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_comments_sutra ON comments(sutra_id, id DESC);
CREATE INDEX idx_comments_user  ON comments(user_id, created_at);
