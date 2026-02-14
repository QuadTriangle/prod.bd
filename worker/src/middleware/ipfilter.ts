// IP allowlisting middleware
// Returns 403 if the visitor IP is not in the allowlist.
// Supports IPv4, IPv6, and CIDR notation for both.

import { registerMiddleware } from "../plugins";

/** Parse an IPv4 address into a 4-byte Uint8Array, or null. */
function parseIPv4(ip: string): Uint8Array | null {
    const parts = ip.split(".");
    if (parts.length !== 4) return null;
    const bytes = new Uint8Array(4);
    for (let i = 0; i < 4; i++) {
        const n = parseInt(parts[i], 10);
        if (isNaN(n) || n < 0 || n > 255) return null;
        bytes[i] = n;
    }
    return bytes;
}

/** Parse an IPv6 address into a 16-byte Uint8Array, or null. Handles :: expansion and IPv4-mapped. */
function parseIPv6(ip: string): Uint8Array | null {
    // Handle IPv4-mapped IPv6 (e.g. ::ffff:1.2.3.4)
    const v4Suffix = ip.match(/:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
    if (v4Suffix) {
        const v4 = parseIPv4(v4Suffix[1]);
        if (!v4) return null;
        const prefix = ip.slice(0, ip.length - v4Suffix[1].length - 1);
        const prefixBytes = parseIPv6Pure(prefix ? prefix + ":" : "::");
        if (!prefixBytes) return null;
        prefixBytes[12] = v4[0];
        prefixBytes[13] = v4[1];
        prefixBytes[14] = v4[2];
        prefixBytes[15] = v4[3];
        return prefixBytes;
    }
    return parseIPv6Pure(ip);
}

function parseIPv6Pure(ip: string): Uint8Array | null {
    const halves = ip.split("::");
    if (halves.length > 2) return null;

    const bytes = new Uint8Array(16);

    const left = halves[0] ? halves[0].split(":") : [];
    const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];

    if (halves.length === 1 && left.length !== 8) return null;
    if (left.length + right.length > 8) return null;

    let pos = 0;
    for (const group of left) {
        const val = parseInt(group, 16);
        if (isNaN(val) || val < 0 || val > 0xffff) return null;
        bytes[pos++] = (val >> 8) & 0xff;
        bytes[pos++] = val & 0xff;
    }

    // :: fills the gap with zeros
    if (halves.length === 2) {
        pos = 16 - right.length * 2;
    }

    for (const group of right) {
        const val = parseInt(group, 16);
        if (isNaN(val) || val < 0 || val > 0xffff) return null;
        bytes[pos++] = (val >> 8) & 0xff;
        bytes[pos++] = val & 0xff;
    }

    return bytes;
}

/** Normalize an IP string to a byte array. IPv4 returns 4 bytes, IPv6 returns 16 bytes. */
function parseIP(ip: string): Uint8Array | null {
    if (ip.includes(":")) return parseIPv6(ip);
    return parseIPv4(ip);
}

/** Check whether two byte arrays match up to `prefixBits` bits. */
function matchesPrefix(a: Uint8Array, b: Uint8Array, prefixBits: number): boolean {
    if (a.length !== b.length) return false;
    const fullBytes = prefixBits >> 3;
    for (let i = 0; i < fullBytes; i++) {
        if (a[i] !== b[i]) return false;
    }
    const remainingBits = prefixBits & 7;
    if (remainingBits > 0) {
        const mask = 0xff << (8 - remainingBits);
        if ((a[fullBytes] & mask) !== (b[fullBytes] & mask)) return false;
    }
    return true;
}

/** Check whether an IP matches an allowlist entry (exact IP or CIDR). */
function ipMatchesEntry(ip: string, entry: string): boolean {
    const slash = entry.indexOf("/");

    if (slash === -1) {
        // Exact match — compare parsed bytes so "::1" matches "0:0:0:0:0:0:0:1"
        const a = parseIP(ip);
        const b = parseIP(entry);
        if (!a || !b || a.length !== b.length) return false;
        return a.every((v, i) => v === b[i]);
    }

    // CIDR match
    const subnet = entry.slice(0, slash);
    const prefix = parseInt(entry.slice(slash + 1), 10);
    if (isNaN(prefix)) return false;

    const ipBytes = parseIP(ip);
    const subnetBytes = parseIP(subnet);
    if (!ipBytes || !subnetBytes) return false;

    const maxBits = ipBytes.length * 8;
    if (prefix < 0 || prefix > maxBits) return false;

    return matchesPrefix(ipBytes, subnetBytes, prefix);
}

registerMiddleware(async (c, next) => {
    const config = c.get("tunnelConfig") as Record<string, unknown> | undefined;
    const allowIps = config?.allowIps;

    // Not configured — pass through
    if (!Array.isArray(allowIps) || allowIps.length === 0) {
        return next();
    }

    const visitorIp = c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for")?.split(",")[0]?.trim();

    if (!visitorIp) {
        c.res = c.text("Forbidden", 403);
        return;
    }

    const allowed = allowIps.some((entry: string) => ipMatchesEntry(visitorIp, entry));

    if (!allowed) {
        c.res = c.text("Forbidden", 403);
        return;
    }

    return next();
});
