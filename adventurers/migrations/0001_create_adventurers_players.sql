-- Players and points for the Adventurers Club leaderboard.
CREATE TABLE IF NOT EXISTS adventurers_players (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  -- SHA-256 of the child's document number (+ app salt). The raw document is never stored.
  doc_hash TEXT NOT NULL UNIQUE,
  -- Last 2 digits, only as a login hint (never the full document).
  doc_hint TEXT NOT NULL,
  points INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_players_points ON adventurers_players (points DESC);
