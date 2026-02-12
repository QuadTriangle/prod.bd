-- Migration number: 0002 	 2026-02-13
-- Add per-tunnel config column for plugin features (auth, rate limit, IP filter, TTL, etc.)

ALTER TABLE tunnels ADD COLUMN config TEXT NOT NULL DEFAULT '{}';
