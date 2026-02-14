// Basic auth middleware
// Reads config.auth ("user:pass") and validates the Authorization header.
// Returns 401 with WWW-Authenticate challenge if missing or invalid.

import { registerMiddleware } from "../plugins";

registerMiddleware(async (c, next) => {
    const config = c.get("tunnelConfig") as Record<string, unknown> | undefined;
    const authConfig = config?.auth;

    if (typeof authConfig !== "string" || !authConfig) {
        return next();
    }

    const header = c.req.header("authorization");

    if (!header || !header.startsWith("Basic ")) {
        c.res = new Response("Unauthorized", {
            status: 401,
            headers: { "WWW-Authenticate": 'Basic realm="Tunnel"' },
        });
        return next();
    }

    const decoded = atob(header.slice(6));

    if (decoded !== authConfig) {
        c.res = new Response("Unauthorized", {
            status: 401,
            headers: { "WWW-Authenticate": 'Basic realm="Tunnel"' },
        });
        return next();
    }

    return next();
});
