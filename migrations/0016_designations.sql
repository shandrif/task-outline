-- Designations (staff positions and trainer designations): one list set by the admin, picked from a dropdown everywhere else.
CREATE TABLE designations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('staff', 'trainer')),
  name TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX designations_kind_name ON designations (kind, name COLLATE NOCASE);

INSERT INTO designations (kind, name, sort) VALUES
  ('staff', 'Barista', 1), ('staff', 'Cashier', 2), ('staff', 'Team Leader', 3), ('staff', 'Store Manager', 4), ('staff', 'Cleaner', 5),
  ('staff', 'Waiter', 6), ('staff', 'Runner', 7), ('staff', 'Busser', 8), ('staff', 'Dispatcher', 9), ('staff', 'Production Operator', 10),
  ('trainer', 'Trainer', 1), ('trainer', 'Senior Trainer', 2), ('trainer', 'Training Manager', 3);
