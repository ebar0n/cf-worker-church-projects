-- Split the daily cap by activity type: 5 points from food cards and
-- 5 from quiz questions. Each interaction records its kind
-- ('card' | 'quiz'); older rows without kind count as cards.
ALTER TABLE adventurers_interactions ADD COLUMN kind TEXT NOT NULL DEFAULT '';
