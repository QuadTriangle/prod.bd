// Custom subdomain feature — lets CLI users request a specific subdomain via config.
// Self-registers an onRegister() hook. No edits to index.ts route handlers needed.
//
// Supports two config shapes:
//   { subdomain: "myapp" }           — single name for all ports (or first port)
//   { subdomains: { "3000": "api", "5173": "web" } } — per-port mapping

import { onRegister } from "../plugins";

const RESERVED = new Set(["www", "tunnel", "api", "admin", "app"]);
const SUBDOMAIN_RE = /^[a-z][a-z0-9-]{1,30}[a-z0-9]$/;

function isValid(s: string): boolean {
    return SUBDOMAIN_RE.test(s) && !RESERVED.has(s);
}

onRegister(async (ctx, result) => {
    // Build port->name mapping from config
    const portNames: Record<number, string> = {};

    const perPort = ctx.config.subdomains as Record<string, string> | undefined;
    const global = ctx.config.subdomain as string | undefined;

    if (perPort && typeof perPort === "object") {
        for (const [portStr, name] of Object.entries(perPort)) {
            const port = parseInt(portStr, 10);
            if (!isNaN(port) && typeof name === "string") {
                portNames[port] = name;
            }
        }
    } else if (typeof global === "string" && global) {
        // Apply to all ports
        for (const port of ctx.ports) {
            portNames[port] = ctx.ports.length === 1 ? global : `${global}-${port}`;
        }
    } else {
        return;
    }

    const configStr = JSON.stringify(ctx.config);

    for (const port of ctx.ports) {
        const sub = portNames[port];
        if (!sub) continue;

        if (!isValid(sub)) {
            result.extra.subdomainError = `Invalid subdomain "${sub}". Use 3-32 lowercase alphanumeric/hyphens, starting with a letter.`;
            return;
        }

        // Already mapped to this client+port?
        const own = await ctx.db.prepare(
            "SELECT subdomain FROM tunnels WHERE client_id = ? AND port = ?"
        ).bind(ctx.clientId, port).first<{ subdomain: string }>();

        if (own && own.subdomain === sub) {
            result.tunnels[port] = sub;
            continue;
        }

        // Check if subdomain is taken by someone else
        const taken = await ctx.db.prepare(
            "SELECT client_id FROM tunnels WHERE subdomain = ?"
        ).bind(sub).first<{ client_id: string }>();

        if (taken && taken.client_id !== ctx.clientId) {
            result.extra.subdomainError = `Subdomain "${sub}" is already taken.`;
            return;
        }

        if (own) {
            // Client has a different subdomain for this port — update it
            await ctx.db.prepare(
                "UPDATE tunnels SET subdomain = ?, config = ? WHERE client_id = ? AND port = ?"
            ).bind(sub, configStr, ctx.clientId, port).run();
        } else {
            // New tunnel — insert with the requested subdomain
            await ctx.db.prepare(
                "INSERT INTO tunnels (subdomain, client_id, port, config) VALUES (?, ?, ?, ?)"
            ).bind(sub, ctx.clientId, port, configStr).run();
        }

        result.tunnels[port] = sub;
    }
});
