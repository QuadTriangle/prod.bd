// CORS middleware
// Reads config.cors (comma-separated origins or "*") and adds CORS headers.
// Handles preflight OPTIONS requests without forwarding to the CLI.

import { registerMiddleware } from "../plugins";

registerMiddleware(async (c, next) => {
    const config = c.get("tunnelConfig") as Record<string, unknown> | undefined;
    const corsConfig = config?.cors;

    if (typeof corsConfig !== "string" || !corsConfig) {
        return next();
    }

    const requestOrigin = c.req.header("origin") || "";
    const allowedOrigin = resolveOrigin(corsConfig, requestOrigin);

    // Preflight
    if (c.req.method === "OPTIONS") {
        c.res = new Response(null, {
            status: 204,
            headers: {
                "Access-Control-Allow-Origin": allowedOrigin,
                "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
                "Access-Control-Allow-Headers": c.req.header("access-control-request-headers") || "*",
                "Access-Control-Max-Age": "86400",
            },
        });
        return;
    }

    await next();

    // Add CORS headers to actual response
    c.res.headers.set("Access-Control-Allow-Origin", allowedOrigin);
    c.res.headers.set("Access-Control-Expose-Headers", "*");
});

function resolveOrigin(corsConfig: string, requestOrigin: string): string {
    if (corsConfig === "*") {
        return "*";
    }

    const allowed = corsConfig.split(",").map((s) => s.trim());
    if (allowed.includes(requestOrigin)) {
        return requestOrigin;
    }

    return "";
}
