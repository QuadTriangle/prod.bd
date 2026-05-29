import { Hono } from "hono";
import { TunnelDO } from "./tunnel-do";
import { tunnelConfig, invalidateConfigCache } from "./middleware/tunnel-config";
import { pluginMiddleware, runRegisterHooks, type RegisterResult } from "./middleware/plugins";

// --- Import feature plugins here ---
// Each plugin self-registers via registerMiddleware() / onRegister() at import time.
import "./middleware/ipfilter";
import "./middleware/auth";
import "./middleware/cors";
import "./middleware/subdomain-block";
import "./middleware/ratelimit";
import "./modules/custom-subdomain";
import { isSubdomainBlocked } from "./middleware/subdomain-block";
import { extractSubdomain } from "./utils/subdomain";
import { isVersionOk } from "./utils/version";

export { TunnelDO };

const app = new Hono<{ Bindings: Env }>();

// CORS for API routes (dashboard runs on localhost)
app.on("OPTIONS", "/api/*", (c) => {
    const origin = c.req.header("Origin") || "*";
    c.header("Access-Control-Allow-Origin", origin);
    c.header("Access-Control-Allow-Headers", "Authorization, Content-Type");
    c.header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    return c.body(null, 204);
});
app.use("/api/*", async (c, next) => {
    const origin = c.req.header("Origin") || "*";
    c.header("Access-Control-Allow-Origin", origin);
    c.header("Access-Control-Allow-Headers", "Authorization, Content-Type");
    await next();
});

// Generate a random subdomain
function generateSubdomain(length: number): string {
    const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    let result = "";
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

async function allocateSubdomain(db: D1Database, clientId: string, port: number, config: string = "{}"): Promise<string | null> {
    const maxRetries = 10;
    let subdomainLength = 4;
    let retries = 0;

    while (retries < maxRetries) {
        const subdomain = generateSubdomain(subdomainLength);

        // Skip offensive subdomains
        if (isSubdomainBlocked(subdomain)) { retries++; continue; }

        const existing = await db.prepare(
            "SELECT 1 FROM tunnels WHERE subdomain = ?"
        ).bind(subdomain).first();

        if (!existing) {
            await db.prepare(
                "INSERT INTO tunnels (subdomain, client_id, port, config) VALUES (?, ?, ?, ?)"
            ).bind(subdomain, clientId, port, config).run();
            return subdomain;
        }

        retries++;
        if (retries >= 4) subdomainLength++;
    }

    return null;
}

// Ensure client_id exists (tunnels has FK to clients).
async function ensureClient(db: D1Database, clientId: string): Promise<void> {
    await db.prepare("INSERT OR IGNORE INTO clients (id) VALUES (?)").bind(clientId).run();
}

app.post("/api/register", async (c) => {
    try {
        const version = c.req.header("X-Prod-Version");
        if (version && !isVersionOk(version)) {
            return c.json({ error: "outdated CLI. Please upgrade prod.bd CLI to latest version: curl -fsSL https://prod.bd/install | bash" }, 426);
        }

        const body = await c.req.json<{ clientId: string; ports: number[]; config?: Record<string, unknown> }>();
        const { clientId, ports } = body;
        const configStr = body.config ? JSON.stringify(body.config) : "{}";

        if (!clientId || !ports || !Array.isArray(ports)) {
            return c.json({ error: "Invalid request" }, 400);
        }

        const results: Record<number, string> = {};
        await ensureClient(c.env.DB, clientId);

        // Run register hooks first — plugins like custom-subdomain can pre-claim ports
        const registerResult: RegisterResult = { tunnels: {}, extra: {} };
        const parsedConfig = body.config ?? {};
        await runRegisterHooks(
            { clientId, ports, config: parsedConfig, db: c.env.DB },
            registerResult,
        );

        // If a hook reported an error, bail early
        if (registerResult.extra.subdomainError) {
            return c.json({ error: registerResult.extra.subdomainError }, 400);
        }

        // Check existing mappings
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
            // Port already handled by a register hook (e.g. custom subdomain)
            if (registerResult.tunnels[port]) {
                results[port] = registerResult.tunnels[port];
                continue;
            }

            if (existingMap.has(port)) {
                // Always update config - clears stale config when no plugins are active
                await c.env.DB.prepare(
                    "UPDATE tunnels SET config = ? WHERE client_id = ? AND port = ?"
                ).bind(configStr, clientId, port).run();
                invalidateConfigCache(existingMap.get(port)!);
                results[port] = existingMap.get(port)!;
                continue;
            }

            const subdomain = await allocateSubdomain(c.env.DB, clientId, port, configStr);
            if (!subdomain) {
                return c.json({ error: "Failed to allocate subdomain" }, 500);
            }
            results[port] = subdomain;
        }

        return c.json({ tunnels: results, ...registerResult.extra });
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
    if (!subdomain) return c.text("Missing subdomain", 400);

    // Single global DO for all tunnels
    const id = c.env.TUNNEL_DO.idFromName("temp_global_tunnel");
    const stub = c.env.TUNNEL_DO.get(id);

    return stub.fetch(c.req.raw);
});

// Wildcard handler for incoming traffic
// tunnelConfig() loads config, pluginMiddleware() runs all registered feature middleware.
app.all("*", tunnelConfig(), pluginMiddleware(), async (c) => {
    const url = new URL(c.req.url);
    const subdomain = extractSubdomain(url.hostname, c.env.BASE_DOMAIN);

    if (subdomain === "www" || subdomain === "tunnel" || !subdomain) {
        return c.text("Not Found", 404);
    }

    // Single global DO for all tunnels
    const id = c.env.TUNNEL_DO.idFromName("temp_global_tunnel");
    const stub = c.env.TUNNEL_DO.get(id);

    return stub.fetch(c.req.raw);
});

export default app;
