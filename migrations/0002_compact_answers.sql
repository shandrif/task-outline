-- Store each evaluation's answers as one JSON record (1 DB write per save instead of 1 per answer),
-- and keep per-section totals only once, at submit time (for the dashboard).
ALTER TABLE evaluations ADD COLUMN answers_json TEXT NOT NULL DEFAULT '{}';   -- {"<item_id>":[trained,performed]}
ALTER TABLE evaluations ADD COLUMN skips_json TEXT NOT NULL DEFAULT '[]';     -- [section_id,...] marked not applicable

CREATE TABLE eval_sections (
  evaluation_id INTEGER NOT NULL REFERENCES evaluations(id) ON DELETE CASCADE,
  section_id INTEGER NOT NULL REFERENCES sections(id),
  score INTEGER NOT NULL,
  max INTEGER NOT NULL,
  PRIMARY KEY (evaluation_id, section_id)
);

DROP TABLE answers;
DROP TABLE eval_skips;
