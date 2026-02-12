import { DurableObject } from "cloudflare:workers";

interface TunnelRequest {
    id: string;
    method: string;
    path: string;
    headers: Record<string, string[]>;
    body?: string; // Base64 encoded body
}

interface TunnelResponse {
    id: string;
    status: number;
    headers: Record<string, string[]>;
    body?: string; // Base64 encoded body
}

export class TunnelDO extends DurableObject {
    private tunnels = new Map<string, WebSocket>();
    // Reverse mapping for cleanup: WebSocket -> Subdomain
    private wsToSubdomain = new Map<WebSocket, string>();

    private pendingRequests = new Map<
        string,
        { resolve: (resp: TunnelResponse) => void; reject: (err: Error) => void }
    >();

    constructor(ctx: DurableObjectState, env: Env) {
        super(ctx, env);
    }

    async fetch(request: Request): Promise<Response> {
        // Handle WebSocket Upgrade (CLI connecting)
        if (request.headers.get("Upgrade") === "websocket") {
            return this.handleWebSocketUpgrade(request);
        }

        const url = new URL(request.url);
        const hostname = url.hostname;
        const subdomain = hostname.split(".")[0];

        // Handle incoming HTTP request (Visitor)
        const ws = this.tunnels.get(subdomain);
        if (ws && ws.readyState === WebSocket.OPEN) {
            return this.proxyRequestToTunnel(request, ws);
        }

        return new Response("Tunnel not connected", { status: 502 });
    }

    private async handleWebSocketUpgrade(request: Request): Promise<Response> {
        const url = new URL(request.url);
        const subdomain = url.searchParams.get("subdomain");

        if (!subdomain) {
            return new Response("Missing subdomain", { status: 400 });
        }

        const pair = new WebSocketPair();
        const [client, server] = [pair[0], pair[1]];

        this.ctx.acceptWebSocket(server);

        // If there was an existing connection for this subdomain, close it
        const existing = this.tunnels.get(subdomain);
        if (existing) {
            existing.close(1000, "New connection replacing old one");
            this.wsToSubdomain.delete(existing);
        }

        this.tunnels.set(subdomain, server);
        this.wsToSubdomain.set(server, subdomain);

        return new Response(null, {
            status: 101,
            webSocket: client,
        });
    }

    async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
        if (typeof message !== "string") return;

        try {
            const response: TunnelResponse = JSON.parse(message);
            const pending = this.pendingRequests.get(response.id);
            if (pending) {
                pending.resolve(response);
                this.pendingRequests.delete(response.id);
            }
        } catch (e) {
            console.error("Failed to parse tunnel response:", e);
        }
    }

    async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean) {
        const subdomain = this.wsToSubdomain.get(ws);
        console.log(`Tunnel closed for ${subdomain || "unknown"}:`, code, reason);

        if (subdomain) {
            this.tunnels.delete(subdomain);
            this.wsToSubdomain.delete(ws);
        }

        // TODO: Reject all pending requests for this tunnel
    }

    async webSocketError(ws: WebSocket, error: unknown) {
        const subdomain = this.wsToSubdomain.get(ws);
        console.error(`Tunnel error for ${subdomain || "unknown"}:`, error);
    }

    private async proxyRequestToTunnel(request: Request, ws: WebSocket): Promise<Response> {
        const reqId = crypto.randomUUID();
        const url = new URL(request.url);

        // Convert Headers to multi-value map
        const headers: Record<string, string[]> = {};
        for (const [key, value] of request.headers) {
            // Headers.entries() joins multi-value with ", " — split them back
            if (headers[key]) {
                headers[key].push(value);
            } else {
                headers[key] = [value];
            }
        }

        const tunnelReq: TunnelRequest = {
            id: reqId,
            method: request.method,
            path: url.pathname + url.search,
            headers,
        };

        const hasBody = request.method !== "GET" && request.method !== "HEAD";
        if (hasBody) {
            const arrayBuffer = await request.arrayBuffer();
            // Safe base64 encoding that handles large bodies
            const bytes = new Uint8Array(arrayBuffer);
            let binary = "";
            const chunkSize = 8192;
            for (let i = 0; i < bytes.length; i += chunkSize) {
                const chunk = bytes.subarray(i, i + chunkSize);
                binary += String.fromCharCode(...chunk);
            }
            tunnelReq.body = btoa(binary);
        }

        return new Promise<Response>((resolve) => {
            // Timeout after 30s (aligned with CLI proxy timeout)
            const timeout = setTimeout(() => {
                this.pendingRequests.delete(reqId);
                resolve(new Response("Gateway Timeout", { status: 504 }));
            }, 30000);

            this.pendingRequests.set(reqId, {
                resolve: (tunnelResp) => {
                    clearTimeout(timeout);
                    const body = tunnelResp.body
                        ? Uint8Array.from(atob(tunnelResp.body), (c) => c.charCodeAt(0))
                        : null;

                    // Build response with multi-value headers
                    const respHeaders = new Headers();
                    for (const [key, values] of Object.entries(tunnelResp.headers)) {
                        for (const v of values) {
                            respHeaders.append(key, v);
                        }
                    }

                    resolve(
                        new Response(body, {
                            status: tunnelResp.status,
                            headers: respHeaders,
                        })
                    );
                },
                reject: (err) => {
                    clearTimeout(timeout);
                    resolve(new Response("Tunnel Error: " + err.message, { status: 502 }));
                },
            });

            try {
                ws.send(JSON.stringify(tunnelReq));
            } catch (e) {
                this.pendingRequests.delete(reqId);
                clearTimeout(timeout);
                resolve(new Response("Tunnel disconnected during request", { status: 502 }));
            }
        });
    }
}
