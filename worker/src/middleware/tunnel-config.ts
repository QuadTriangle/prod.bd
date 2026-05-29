// Tunnel config middleware - loads per-tunnel config from D1 and sets it on the Hono context.
// Config is a schemaless Record<string, unknown>. Each middleware reads the keys it owns.

import type { Context, Next } from "hono";
import { extractSubdomain } from "../utils/subdomain";

export type TunnelConfig = Record<string, unknown>;

// Cache config in memory to avoid D1 reads on every request.
const configCache = new Map<string, { config: TunnelConfig; fetchedAt: number }>();
const CACHE_TTL_MS = 30_000; // 30s

/** Invalidate cached config for a subdomain (call after config update). */
export function invalidateConfigCache(subdomain: string): void {
    configCache.delete(subdomain);
}

async function loadConfig(db: D1Database, subdomain: string): Promise<TunnelConfig> {
    const cached = configCache.get(subdomain);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.config;

    const row = await db.prepare(
        "SELECT config FROM tunnels WHERE subdomain = ?"
    ).bind(subdomain).first<{ config: string }>();

    let config: TunnelConfig = {};
    if (row?.config) {
        try { config = JSON.parse(row.config); } catch {}
    }

    configCache.set(subdomain, { config, fetchedAt: Date.now() });
    return config;
}

/**
 * Hono middleware that extracts the subdomain, loads its config from D1,
 * and sets both on the context for downstream middleware.
 */
export function tunnelConfig() {
    return async (c: Context, next: Next) => {
        const url = new URL(c.req.url);
        const subdomain = extractSubdomain(url.hostname, c.env.BASE_DOMAIN);

        // Skip config loading for non-tunnel routes
        const nonTunnelRoutes = ["www", "tunnel", "tunnel-staging"]
        if (!subdomain || nonTunnelRoutes.includes(subdomain)) {
            return next();
        }

        c.set("subdomain", subdomain);

        const config = await loadConfig(c.env.DB, subdomain);
        c.set("tunnelConfig", config);

        return next();
    };
}
