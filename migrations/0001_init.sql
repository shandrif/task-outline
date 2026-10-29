-- HM Staff Knowledge Evaluation — schema
CREATE TABLE positions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE sections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  position_id INTEGER NOT NULL REFERENCES positions(id),
  title TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_sections_position ON sections(position_id, sort);

-- kind: question (scored) | heading (sub-title inside a section) | note (info line)
CREATE TABLE items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  section_id INTEGER NOT NULL REFERENCES sections(id),
  kind TEXT NOT NULL DEFAULT 'question' CHECK (kind IN ('question','heading','note')),
  text TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_items_section ON items(section_id, sort);

CREATE TABLE stores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  code TEXT,
  region TEXT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  pw_version INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login TEXT
);

CREATE TABLE evaluations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id INTEGER NOT NULL REFERENCES stores(id),
  position_id INTEGER NOT NULL REFERENCES positions(id),
  staff_name TEXT NOT NULL,
  staff_code TEXT,
  evaluator TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted')),
  score INTEGER,
  max_score INTEGER,
  trained_count INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  submitted_at TEXT
);
CREATE INDEX idx_eval_store ON evaluations(store_id, status);
CREATE INDEX idx_eval_position ON evaluations(position_id);

CREATE TABLE answers (
  evaluation_id INTEGER NOT NULL REFERENCES evaluations(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES items(id),
  trained INTEGER,     -- Received training: 1 yes / 0 no
  performed INTEGER,   -- Performed correctly: 1 yes (scores 1) / 0 no
  PRIMARY KEY (evaluation_id, item_id)
);

-- Sections marked "not applicable" for a given evaluation (excluded from scoring)
CREATE TABLE eval_skips (
  evaluation_id INTEGER NOT NULL REFERENCES evaluations(id) ON DELETE CASCADE,
  section_id INTEGER NOT NULL REFERENCES sections(id),
  PRIMARY KEY (evaluation_id, section_id)
);

CREATE TABLE login_attempts (
  key TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX idx_login_attempts ON login_attempts(key, at);
