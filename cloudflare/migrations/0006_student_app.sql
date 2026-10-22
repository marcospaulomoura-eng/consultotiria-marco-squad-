-- Additive migration: existing clients, contracts and payments remain intact.
CREATE TABLE IF NOT EXISTS fitness_access (
  client_id TEXT PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  community INTEGER NOT NULL DEFAULT 0 CHECK (community IN (0, 1)),
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS fitness_sessions (
  token_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES fitness_access(client_id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS fitness_attempts (
  ip_key TEXT PRIMARY KEY, count INTEGER NOT NULL, reset_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS fitness_catalog (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('food', 'exercise')), data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS fitness_workouts (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  data TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS fitness_workout_client ON fitness_workouts(client_id);
CREATE TABLE IF NOT EXISTS fitness_diets (
  client_id TEXT PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
  data TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS fitness_logs (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  workout_id TEXT NOT NULL,
  workout_name TEXT NOT NULL,
  day TEXT NOT NULL, created_at TEXT NOT NULL,
  UNIQUE(client_id, workout_id, day)
);
CREATE INDEX IF NOT EXISTS fitness_logs_day ON fitness_logs(day, client_id);
CREATE TABLE IF NOT EXISTS fitness_posts (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES fitness_access(client_id) ON DELETE CASCADE,
  caption TEXT NOT NULL, image TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS fitness_posts_created ON fitness_posts(created_at);
CREATE TABLE IF NOT EXISTS fitness_likes (
  post_id TEXT NOT NULL REFERENCES fitness_posts(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES fitness_access(client_id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, client_id)
);
CREATE TABLE IF NOT EXISTS fitness_comments (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES fitness_posts(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES fitness_access(client_id) ON DELETE CASCADE,
  text TEXT NOT NULL, created_at TEXT NOT NULL
);
