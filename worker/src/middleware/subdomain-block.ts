// Subdomain blocklist middleware
// Blocks requests to subdomains containing offensive or inappropriate words.
// Also exports the check so allocateSubdomain() can reject them at creation time.

import { registerMiddleware } from "../plugins";

// Offensive words and common leet-speak variants
const BLOCKED_PATTERNS: string[] = [
    "xxx", "sex", "s3x", "s€x", "porn", "p0rn", "prn",
    "fuck", "fck", "fuk", "f4ck", "fvck",
    "suck", "suk", "s0ck", "sck",
    "shit", "sh1t", "sht",
    "ass", "a55", "azz",
    "dick", "d1ck", "dik",
    "cock", "c0ck", "cok",
    "cunt", "cvnt", "c0nt",
    "slut", "sl0t", "s1ut",
    "whore", "wh0re", "h0re",
    "bitch", "b1tch", "btch",
    "nigger", "n1gger", "nigg",
    "rape", "r4pe",
    "anal", "an4l",
    "cum", "c0m",
    "nude", "nud3",
    "hentai", "h3ntai",
    "milf", "m1lf",
    "dildo", "d1ldo",
    "penis", "pen1s",
    "vagina", "vag1na",
    "boob", "b00b",
    "tits", "t1ts",
];

// Build a single regex that matches any blocked pattern anywhere in the subdomain
const blockedRegex = new RegExp(
    BLOCKED_PATTERNS.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"),
    "i",
);

/**
 * Returns true if the subdomain contains a blocked word.
 * Use this in allocateSubdomain() to reject offensive random subdomains.
 */
export function isSubdomainBlocked(subdomain: string): boolean {
    return blockedRegex.test(subdomain);
}

// Middleware: block visitor requests to offensive subdomains
registerMiddleware(async (c, next) => {
    const url = new URL(c.req.url);
    const subdomain = url.hostname.split(".")[0];

    if (isSubdomainBlocked(subdomain)) {
        return c.text("Subdomain not allowed", 403);
    }

    return next();
});
