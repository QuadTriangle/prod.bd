// BASE_DOMAIN is a suffix like ".prod.bd" or "-staging.prod.bd".
// Tunnel URLs: subdomain + BASE_DOMAIN → "abc.prod.bd" or "abc-staging.prod.bd"
// Worker URL:  "tunnel" + BASE_DOMAIN  → "tunnel.prod.bd" or "tunnel-staging.prod.bd"

const DEFAULT_BASE_DOMAIN = ".prod.bd";

// Extract subdomain by stripping BASE_DOMAIN suffix from hostname.
// e.g. "abc-staging.prod.bd" with base "-staging.prod.bd" → "abc"
//      "abc.prod.bd" with base ".prod.bd" → "abc"
export function extractSubdomain(hostname: string, baseDomain: string): string {
    baseDomain = baseDomain || DEFAULT_BASE_DOMAIN;
    if (hostname.endsWith(baseDomain)) {
        return hostname.slice(0, -baseDomain.length);
    }
    return hostname.split(".")[0]; // fallback
}
