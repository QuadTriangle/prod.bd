CREATE TABLE IF NOT EXISTS clients (
    id TEXT PRIMARY KEY,
    created_at INTEGER DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS tunnels (
    subdomain TEXT PRIMARY KEY,
    client_id TEXT NOT NULL,
    port INTEGER NOT NULL,
    created_at INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY(client_id) REFERENCES clients(id)
);

CREATE INDEX IF NOT EXISTS idx_tunnels_client_id ON tunnels(client_id);
