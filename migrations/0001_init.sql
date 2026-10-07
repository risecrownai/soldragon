-- 사용자: 구글 로그인 계정(sub)이 기본키. 이메일은 본인에게만 보여 준다.
CREATE TABLE users (
  id         TEXT PRIMARY KEY,
  email      TEXT,
  name       TEXT,
  created_at INTEGER NOT NULL
);

-- 계정에 묶인 솔라나 지갑. 서명으로 소유를 증명한 지갑만 들어간다. 지갑 하나는 계정 하나에만, 계정 하나는 지갑 하나만.
CREATE TABLE wallets (
  address   TEXT PRIMARY KEY,
  user_id   TEXT NOT NULL UNIQUE REFERENCES users(id),
  linked_at INTEGER NOT NULL
);

-- 지갑 묶기용 1회용 서명 문구
CREATE TABLE nonces (
  nonce      TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  address    TEXT NOT NULL,
  message    TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

-- 사용자가 추가한 경전(기본 경전은 코드에 있고 DB에 없다)
CREATE TABLE sutras (
  id         TEXT PRIMARY KEY,
  owner_id   TEXT NOT NULL REFERENCES users(id),
  title      TEXT NOT NULL,
  lang       TEXT NOT NULL,
  paragraphs TEXT NOT NULL,           -- JSON: [{orig,en,ko}]
  is_public  INTEGER NOT NULL DEFAULT 0 CHECK (is_public IN (0,1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_sutras_owner  ON sutras(owner_id);
CREATE INDEX idx_sutras_public ON sutras(is_public, updated_at DESC);

-- 좋아요/싫어요(vote)와 점수(score 1~5). 사용자당 경전 하나에 한 행.
-- sutra_id는 기본 경전의 id(예: heart)이거나 sutras.id
CREATE TABLE reactions (
  sutra_id   TEXT NOT NULL,
  user_id    TEXT NOT NULL REFERENCES users(id),
  vote       INTEGER NOT NULL DEFAULT 0 CHECK (vote IN (-1,0,1)),
  score      INTEGER CHECK (score IS NULL OR (score BETWEEN 1 AND 5)),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (sutra_id, user_id)
);

-- 댓글(100자 이내는 서버에서 검증)
CREATE TABLE comments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  sutra_id   TEXT NOT NULL,
  user_id    TEXT NOT NULL REFERENCES users(id),
  body       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_comments_sutra ON comments(sutra_id, id DESC);
CREATE INDEX idx_comments_user  ON comments(user_id, created_at);
