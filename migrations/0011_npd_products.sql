-- NPD product names are set by the admin only; trainers pick from this list (no free typing, no misspellings).
CREATE TABLE npd_products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- keep every product name already used in existing NPD records
INSERT OR IGNORE INTO npd_products (name)
  SELECT DISTINCT trim(json_extract(data, '$.product_name')) FROM records
  WHERE module='npd' AND trim(COALESCE(json_extract(data, '$.product_name'), '')) <> '';
