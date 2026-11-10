-- Store visit report emails (sent through Brevo).
-- Only ADDS two tables and their indexes; no existing table or row is changed.

-- Every send attempt: who sent which report to whom, and how it went.
CREATE TABLE IF NOT EXISTS sv_emails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER NOT NULL REFERENCES sv_reports(id) ON DELETE CASCADE,
  to_email TEXT NOT NULL,
  cc TEXT NOT NULL DEFAULT '[]',                 -- JSON array of addresses
  recipients INTEGER NOT NULL DEFAULT 1,         -- to + cc, counted against Brevo's daily allowance
  subject TEXT,
  sent_by INTEGER,                               -- trainers.id (NULL = admin)
  sent_by_name TEXT,
  sent_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status TEXT NOT NULL CHECK (status IN ('sent','failed')),
  message_id TEXT,                               -- Brevo's message id
  error TEXT
);
CREATE INDEX IF NOT EXISTS idx_sv_emails_report ON sv_emails(report_id, sent_at);
CREATE INDEX IF NOT EXISTS idx_sv_emails_day ON sv_emails(sent_at);

-- Addresses people have used, so the send dialog can suggest them next time.
-- role 'to' is remembered per store (store_id), role 'cc' for everyone (store_id 0).
CREATE TABLE IF NOT EXISTS email_book (
  email TEXT NOT NULL COLLATE NOCASE,
  role TEXT NOT NULL CHECK (role IN ('to','cc')),
  store_id INTEGER NOT NULL DEFAULT 0,
  uses INTEGER NOT NULL DEFAULT 1,
  last_used TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (email, role, store_id)
);
CREATE INDEX IF NOT EXISTS idx_email_book_recent ON email_book(role, last_used);
