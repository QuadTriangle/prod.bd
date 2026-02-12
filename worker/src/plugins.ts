// Worker plugin system — middleware registry + register hooks.
// Adding a feature = create a middleware file + register it here.
// No edits to index.ts or tunnel-do.ts needed.

import type { Context, Next, MiddlewareHandler } from "hono";

// --- Visitor middleware pipeline ---
// Each middleware can read c.get("tunnelConfig") and c.get("subdomain").
// Return early (e.g. c.text("Forbidden", 403)) to block the request.
// Call next() to pass through.

const visitorMiddleware: MiddlewareHandler[] = [];

/**
 * Register a Hono middleware to run on all visitor requests.
 * Called at module load time from each feature file.
 */
export function registerMiddleware(mw: MiddlewareHandler): void {
    visitorMiddleware.push(mw);
}

/**
 * Returns a single Hono middleware that runs all registered middleware in order.
 * Used in index.ts: app.all("*", tunnelConfig(), pluginMiddleware(), handler)
 */
export function pluginMiddleware(): MiddlewareHandler {
    return async (c: Context, next: Next) => {
        // Build a chain: each middleware calls the next one, or short-circuits
        let index = 0;

        const runNext = async (): Promise<void> => {
            if (index < visitorMiddleware.length) {
                const mw = visitorMiddleware[index++];
                await mw(c, runNext);
            } else {
                await next();
            }
        };

        await runNext();
    };
}

// --- Register hooks ---
// Plugins can hook into the /api/register flow to modify the request or response.

export interface RegisterContext {
    clientId: string;
    ports: number[];
    config: Record<string, unknown>;
    db: D1Database;
}

export interface RegisterResult {
    tunnels: Record<number, string>;
    /** Extra fields to merge into the register response JSON */
    extra: Record<string, unknown>;
}

type RegisterHook = (ctx: RegisterContext, result: RegisterResult) => Promise<void>;

const registerHooks: RegisterHook[] = [];

/**
 * Register a hook that runs after tunnel allocation during /api/register.
 * Can modify the result (e.g. add token to response) or the config.
 */
export function onRegister(hook: RegisterHook): void {
    registerHooks.push(hook);
}

/**
 * Run all register hooks. Called from the register endpoint.
 */
export async function runRegisterHooks(ctx: RegisterContext, result: RegisterResult): Promise<void> {
    for (const hook of registerHooks) {
        await hook(ctx, result);
    }
}
