-- Every answer is stored as one interaction (+1 correct / -1 wrong).
-- The daily cap is computed by counting today's positive interactions,
-- with `day` stored in America/Bogota time. This replaces the
-- day_points/day_date counters.
CREATE TABLE IF NOT EXISTS adventurers_interactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id INTEGER NOT NULL REFERENCES adventurers_players(id),
  delta INTEGER NOT NULL,
  day TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_adventurers_interactions_player_day
  ON adventurers_interactions (player_id, day);
ALTER TABLE adventurers_players DROP COLUMN day_points;
ALTER TABLE adventurers_players DROP COLUMN day_date;
