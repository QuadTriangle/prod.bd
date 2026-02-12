import { Hono } from "hono";
import { TunnelDO } from "./tunnel-do";

export { TunnelDO };

const app = new Hono<{ Bindings: Env }>();

// Generate a random subdomain
function generateSubdomain(length: number): string {
    const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    let result = "";
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

async function allocateSubdomain(db: D1Database, clientId: string, port: number): Promise<string | null> {
    const maxRetries = 10;
    let subdomainLength = 4;
    let retries = 0;

    while (retries < maxRetries) {
        const subdomain = generateSubdomain(subdomainLength);

        const existing = await db.prepare(
            "SELECT 1 FROM tunnels WHERE subdomain = ?"
        ).bind(subdomain).first();

        if (!existing) {
            await db.prepare(
                "INSERT INTO tunnels (subdomain, client_id, port) VALUES (?, ?, ?)"
            ).bind(subdomain, clientId, port).run();
            return subdomain;
        }

        retries++;
        if (retries >= 4) {
            subdomainLength++;
        }
    }

    return null;
}

app.post("/api/register", async (c) => {
    try {
        const body = await c.req.json<{ clientId: string; ports: number[] }>();
        const { clientId, ports } = body;

        if (!clientId || !ports || !Array.isArray(ports)) {
            return c.json({ error: "Invalid request" }, 400);
        }

        const results: Record<number, string> = {};

        // Ensure client exists first (tunnels has FK to clients)
        await c.env.DB.prepare("INSERT OR IGNORE INTO clients (id) VALUES (?)").bind(clientId).run();

        // Check existing mapping
        const { results: existing } = await c.env.DB.prepare(
            "SELECT port, subdomain FROM tunnels WHERE client_id = ?"
        ).bind(clientId).all<{ port: number; subdomain: string }>();

        const existingMap = new Map<number, string>();
        if (existing) {
            for (const row of existing) {
                existingMap.set(row.port, row.subdomain);
            }
        }

        for (const port of ports) {
            if (existingMap.has(port)) {
                results[port] = existingMap.get(port)!;
                continue;
            }

            const subdomain = await allocateSubdomain(c.env.DB, clientId, port);
            if (!subdomain) {
                return c.json({ error: "Failed to allocate subdomain" }, 500);
            }

            results[port] = subdomain;
        }

        return c.json({ tunnels: results });
    } catch (e) {
        console.error("Register failed:", e);
        return c.json({ error: String(e) }, 500);
    }
});

app.get("/_tunnel", async (c) => {
    const upgradeHeader = c.req.header("Upgrade");
    if (!upgradeHeader || upgradeHeader !== "websocket") {
        return c.text("Expected Upgrade: websocket", 426);
    }

    const subdomain = c.req.query("subdomain");
    if (!subdomain) {
        return c.text("Missing subdomain", 400);
    }

    // Single global DO for all tunnels
    const id = c.env.TUNNEL_DO.idFromName("temp_global_tunnel");
    const stub = c.env.TUNNEL_DO.get(id);

    return stub.fetch(c.req.raw);
});

// Wildcard handler for incoming traffic
app.all("*", async (c) => {
    const url = new URL(c.req.url);
    const hostname = url.hostname;


    // assuming the very first part of the hostname is the subdomain.
    const subdomain = hostname.split(".")[0];

    if (subdomain === "www" || subdomain === "tunnel" || !subdomain) {
        return c.text("Not Found", 404);
    }

    // Single global DO for all tunnels
    const id = c.env.TUNNEL_DO.idFromName("temp_global_tunnel");
    const stub = c.env.TUNNEL_DO.get(id);

    return stub.fetch(c.req.raw);
});

export default app;
