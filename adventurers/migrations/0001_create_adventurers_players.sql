-- Adventurers Club points challenge.
-- Players: one row per child; the document number is never stored in
-- plain text (salted SHA-256 hash + last 2 digits as hint).
CREATE TABLE IF NOT EXISTS adventurers_players (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  doc_hash TEXT NOT NULL UNIQUE,
  doc_hint TEXT NOT NULL,
  points INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_adventurers_players_points
  ON adventurers_players (points DESC);

-- Every answer is one interaction (+1 correct / -1 wrong), with `day`
-- in America/Bogota time. The daily cap counts today's positive rows.
CREATE TABLE IF NOT EXISTS adventurers_interactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id INTEGER NOT NULL REFERENCES adventurers_players(id),
  delta INTEGER NOT NULL,
  day TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_adventurers_interactions_player_day
  ON adventurers_interactions (player_id, day);
