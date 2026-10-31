-- Trainers sign up themselves and visit stores; stores no longer log in.
-- A visit = one trainer at one store; a visit holds any number of staff evaluations.

CREATE TABLE trainers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  designation TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  pw_version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','disabled')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  approved_at TEXT,
  last_login TEXT
);

CREATE TABLE visits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trainer_id INTEGER NOT NULL REFERENCES trainers(id),
  store_id INTEGER NOT NULL REFERENCES stores(id),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','completed')),
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at TEXT,
  notes TEXT,
  follow_up INTEGER NOT NULL DEFAULT 0,
  follow_up_date TEXT
);
CREATE INDEX idx_visits_trainer ON visits(trainer_id, started_at);
CREATE INDEX idx_visits_store ON visits(store_id, started_at);

ALTER TABLE evaluations ADD COLUMN visit_id INTEGER REFERENCES visits(id);
ALTER TABLE evaluations ADD COLUMN trainer_id INTEGER REFERENCES trainers(id);
ALTER TABLE evaluations ADD COLUMN improvement_notes TEXT;
CREATE INDEX idx_eval_visit ON evaluations(visit_id);
CREATE INDEX idx_eval_trainer ON evaluations(trainer_id, status);

-- locked: admin edited the store by hand, so the weekly mapping sync must not overwrite its details
-- manual: added by hand (not from the mapping file)
ALTER TABLE stores ADD COLUMN locked INTEGER NOT NULL DEFAULT 0;
ALTER TABLE stores ADD COLUMN manual INTEGER NOT NULL DEFAULT 0;

-- Keep evaluations made before trainers existed: one "legacy" visit per store
INSERT INTO trainers (employee_id, name, designation, password_hash, status) VALUES ('LEGACY', 'Earlier evaluations (store logins)', '-', '!', 'disabled');
INSERT INTO visits (trainer_id, store_id, status, started_at, ended_at, notes)
  SELECT (SELECT id FROM trainers WHERE employee_id='LEGACY'), store_id, 'completed', MIN(created_at), MAX(created_at), 'Imported from the earlier store-login version'
  FROM evaluations GROUP BY store_id;
UPDATE evaluations
  SET trainer_id = (SELECT id FROM trainers WHERE employee_id='LEGACY'),
      visit_id = (SELECT v.id FROM visits v WHERE v.store_id = evaluations.store_id AND v.notes LIKE 'Imported from%')
  WHERE visit_id IS NULL;

-- store passwords are no longer used
UPDATE stores SET password_enc = NULL;
