-- LMS: multiple-choice quizzes set by the admin; trainers run them in stores by QR code; staff answer on their own phones.
CREATE TABLE lms_quizzes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  position_id INTEGER REFERENCES positions(id),
  pass_mark INTEGER NOT NULL DEFAULT 80,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT
);
CREATE TABLE lms_questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quiz_id INTEGER NOT NULL REFERENCES lms_quizzes(id),
  text TEXT NOT NULL,
  options TEXT NOT NULL,            -- JSON array of 2-5 answer texts
  correct INTEGER NOT NULL,         -- index of the right answer in options
  sort INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX lms_questions_quiz ON lms_questions (quiz_id, sort);
-- one quiz run by one trainer at one store; the questions are copied in when it starts, so later edits never change past results
CREATE TABLE lms_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quiz_id INTEGER NOT NULL REFERENCES lms_quizzes(id),
  trainer_id INTEGER NOT NULL REFERENCES trainers(id),
  store_id INTEGER NOT NULL REFERENCES stores(id),
  visit_id INTEGER REFERENCES visits(id),
  token TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  pass_mark INTEGER NOT NULL,
  questions TEXT NOT NULL,          -- JSON snapshot: [{id, text, options, correct}]
  opened_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closes_at TEXT NOT NULL,
  closed_at TEXT
);
CREATE INDEX lms_sessions_trainer ON lms_sessions (trainer_id, opened_at);
CREATE INDEX lms_sessions_opened ON lms_sessions (opened_at);
CREATE TABLE lms_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES lms_sessions(id) ON DELETE CASCADE,
  staff_name TEXT NOT NULL,
  emp_id TEXT NOT NULL,
  emp_key TEXT NOT NULL,            -- lower-case employee ID: one attempt per person per session
  position TEXT,
  answers TEXT NOT NULL,            -- JSON {questionId: chosen option index}
  score INTEGER NOT NULL,
  total INTEGER NOT NULL,
  pct REAL NOT NULL,
  passed INTEGER NOT NULL,
  submitted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX lms_attempts_once ON lms_attempts (session_id, emp_key);
