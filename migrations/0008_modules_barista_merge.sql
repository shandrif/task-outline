-- 1) New modules: generic record tables (onboarding, NPD, training/coaching, people development) and store visit reports.
CREATE TABLE records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  module TEXT NOT NULL,                 -- onboarding | npd | coaching | development
  kind TEXT NOT NULL DEFAULT '',        -- onboarding: hm|external|international; development: track; else ''
  emp_id TEXT,
  name TEXT,
  pct REAL,                             -- verification % (0-100)
  data TEXT NOT NULL DEFAULT '{}',      -- remaining fields as JSON
  created_by INTEGER,                   -- trainers.id (NULL = admin)
  created_by_name TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT
);
CREATE INDEX idx_records_mod ON records(module, kind, created_at);
CREATE INDEX idx_records_owner ON records(created_by, module, created_at);

CREATE TABLE sv_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id INTEGER NOT NULL REFERENCES stores(id),
  trainer_id INTEGER REFERENCES trainers(id),
  visit_date TEXT NOT NULL,             -- YYYY-MM-DD
  visit_time TEXT,
  branch_manager TEXT,
  visit_type TEXT,
  body TEXT NOT NULL DEFAULT '{}',      -- readiness, quality, team, highlights, actions, comment, acknowledgement (JSON)
  readiness_pct REAL,
  quality_avg REAL,                     -- average 1-5 of scored products
  overall_rating TEXT,
  overall_score REAL,                   -- out of 5
  follow_up INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT
);
CREATE INDEX idx_sv_date ON sv_reports(visit_date);
CREATE INDEX idx_sv_trainer ON sv_reports(trainer_id, visit_date);
CREATE INDEX idx_sv_store ON sv_reports(store_id, visit_date);

-- 2) Barista + Beverages become one position, "Barista verification". Existing evaluations keep their answers
--    (answers are stored per question id, and the questions simply move into the merged position).
UPDATE evaluations SET position_id=(SELECT id FROM positions WHERE name='Barista') WHERE position_id=(SELECT id FROM positions WHERE name='Beverages') AND EXISTS (SELECT 1 FROM positions WHERE name='Barista');
UPDATE sections SET sort=sort+100, position_id=(SELECT id FROM positions WHERE name='Barista') WHERE position_id=(SELECT id FROM positions WHERE name='Beverages') AND EXISTS (SELECT 1 FROM positions WHERE name='Barista');
DELETE FROM positions WHERE name='Beverages' AND NOT EXISTS (SELECT 1 FROM sections WHERE position_id=positions.id) AND NOT EXISTS (SELECT 1 FROM evaluations WHERE position_id=positions.id);
UPDATE positions SET name='Barista verification' WHERE name='Barista';
