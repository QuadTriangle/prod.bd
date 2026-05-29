// CLI version validation helpers.

// Minimum CLI version required. Clients without X-Prod-Version or below this are rejected.
const MIN_CLI_VERSION = "0.2.0";

export function parseVersion(v: string): number[] {
    return v.split(".").map(Number);
}

export function isVersionOk(v: string | undefined): boolean {
    if (!v || v === "0.0.0-dev") return true; // dev builds always pass
    const min = parseVersion(MIN_CLI_VERSION);
    const cur = parseVersion(v);
    for (let i = 0; i < 3; i++) {
        if ((cur[i] || 0) > (min[i] || 0)) return true;
        if ((cur[i] || 0) < (min[i] || 0)) return false;
    }
    return true; // equal
}
