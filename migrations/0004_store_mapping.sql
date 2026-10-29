-- Stores now come from the area-manager mapping file (synced weekly), not from an upload.
ALTER TABLE stores ADD COLUMN area_manager TEXT;
ALTER TABLE stores ADD COLUMN rom TEXT;
ALTER TABLE stores ADD COLUMN city TEXT;
ALTER TABLE stores ADD COLUMN sync_batch TEXT;                          -- id of the last sync that saw this store
ALTER TABLE stores ADD COLUMN sync_disabled INTEGER NOT NULL DEFAULT 0; -- 1 = disabled automatically because it left the file

CREATE TABLE sync_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  source TEXT,
  total INTEGER, added INTEGER, updated INTEGER, disabled INTEGER
);
