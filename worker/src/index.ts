import { Hono } from "hono";
import { TunnelDO } from "./tunnel-do";

export { TunnelDO };

const app = new Hono<{ Bindings: Env }>();

// Generate a random subdomain
function generateSubdomain(): string {
    const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    let result = "";
    for (let i = 0; i < 4; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
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

            // Generate new subdomain
            let subdomain = generateSubdomain();
            let retries = 10;
            while (retries > 0) {
                try {
                    await c.env.DB.prepare(
                        "INSERT INTO tunnels (subdomain, client_id, port) VALUES (?, ?, ?)"
                    ).bind(subdomain, clientId, port).run();
                    break;
                } catch (e) {
                    console.error(`Insert tunnel failed (retries left: ${retries - 1}):`, e);
                    subdomain = generateSubdomain();
                    retries--;
                }
            }
            if (retries === 0) {
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
