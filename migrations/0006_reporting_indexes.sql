-- Keep dashboard queries cheap as visits accumulate: date-range indexes + "last visit" stored on the trainer/store row.
CREATE INDEX idx_visits_started ON visits(started_at);
CREATE INDEX idx_visits_trainer_store ON visits(trainer_id, store_id, started_at);
CREATE INDEX idx_eval_status_submitted ON evaluations(status, submitted_at);
CREATE INDEX idx_eval_trainer_submitted ON evaluations(trainer_id, status, submitted_at);

ALTER TABLE trainers ADD COLUMN last_visit_at TEXT;
ALTER TABLE stores ADD COLUMN last_visit_at TEXT;
UPDATE trainers SET last_visit_at = (SELECT MAX(started_at) FROM visits WHERE trainer_id = trainers.id);
UPDATE stores SET last_visit_at = (SELECT MAX(started_at) FROM visits WHERE store_id = stores.id);
