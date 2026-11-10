-- Workshop / Projects tab: workshops, projects, weekly accomplishments and upcoming weekly accomplishments.
-- A table of its own (not `records`), so none of it reaches the dashboards.
-- This migration only ADDS a table and indexes; it does not touch any existing table or row.
CREATE TABLE IF NOT EXISTS workshop_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  section TEXT NOT NULL CHECK (section IN ('workshop','project','weekly','upcoming')),
  entry_date TEXT NOT NULL,                       -- YYYY-MM-DD, as entered
  title TEXT,                                     -- workshop / project name (empty for the weekly sections)
  details TEXT NOT NULL,                          -- what they did / accomplishments
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','ongoing','completed')),
  trainer_id INTEGER REFERENCES trainers(id),     -- NULL = entered by the admin
  created_by_name TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_workshop_section ON workshop_entries(section, entry_date);
CREATE INDEX IF NOT EXISTS idx_workshop_trainer ON workshop_entries(trainer_id, section, entry_date);
