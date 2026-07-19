-- Daily points cap: track how many points were earned on which day.
ALTER TABLE adventurers_players ADD COLUMN day_points INTEGER NOT NULL DEFAULT 0;
ALTER TABLE adventurers_players ADD COLUMN day_date TEXT NOT NULL DEFAULT '';
