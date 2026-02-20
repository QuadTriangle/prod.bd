// Per-subdomain rate limiting middleware
// Fixed-window counter in module-level memory. Resets on worker restart.

import { registerMiddleware } from "../plugins";

const windows = new Map<string, { count: number; reset: number }>();

registerMiddleware(async (c, next) => {
    const window = 60_000;
    const limit = 600; /* 600 requests per minute */

    const subdomain = c.get("subdomain") as string;
    const now = Date.now();
    const entry = windows.get(subdomain);

    if (!entry || now > entry.reset) {
        windows.set(subdomain, { count: 1, reset: now + window });
        return next();
    }

    if (entry.count >= limit) {
        const retryAfter = Math.ceil((entry.reset - now) / 1000);
        c.header("Retry-After", String(retryAfter));
        return c.text("Rate limit exceeded", 429);
    }

    entry.count++;
    return next();
});
