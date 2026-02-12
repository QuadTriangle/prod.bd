CREATE TABLE IF NOT EXISTS clients (
    id TEXT PRIMARY KEY,
    created_at INTEGER DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS tunnels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subdomain TEXT NOT NULL UNIQUE,
    client_id TEXT NOT NULL,
    port INTEGER NOT NULL,
    config TEXT NOT NULL DEFAULT '{}'
    created_at INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
);

-- faster client_id lookup
CREATE INDEX IF NOT EXISTS idx_tunnels_client_id ON tunnels(client_id);
-- prevents duplicate tunnels
CREATE UNIQUE INDEX IF NOT EXISTS idx_tunnels_client_port ON tunnels (client_id, port);
