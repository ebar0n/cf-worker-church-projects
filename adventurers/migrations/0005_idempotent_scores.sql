-- Identifies retries without keeping documents in the interaction log.
ALTER TABLE adventurers_interactions ADD COLUMN request_id TEXT;
CREATE UNIQUE INDEX idx_adventurers_interactions_request
  ON adventurers_interactions (player_id, request_id);
