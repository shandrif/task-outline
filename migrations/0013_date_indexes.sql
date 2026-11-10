-- Date indexes so period filters read only the rows in the period (keeps reads flat as history grows).
-- Indexes only: no table or row is changed.
CREATE INDEX IF NOT EXISTS idx_records_created ON records(created_at);
CREATE INDEX IF NOT EXISTS idx_sv_created ON sv_reports(created_at);
CREATE INDEX IF NOT EXISTS idx_eval_created ON evaluations(created_at);
