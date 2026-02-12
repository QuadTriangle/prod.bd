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
    // Reconstructed after Worker hibernation to restore active WebSocket tunnels
    private tunnels = new Map<string, WebSocket>();

    private pendingRequests = new Map<
        string,
        { subdomain: string; resolve: (resp: TunnelResponse) => void; reject: (err: Error) => void }
    >();

    constructor(ctx: DurableObjectState, env: Env) {
        super(ctx, env);

        // Auto-respond to ping/pong without active DO.
        this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));

        // Restore subdomain→WebSocket mappings from hibernated sockets
        this.ctx.getWebSockets().forEach((ws) => {
            const attachment = ws.deserializeAttachment() as { subdomain: string } | null;
            if (attachment?.subdomain) {
                this.tunnels.set(attachment.subdomain, ws);
            }
        });
    }

    private getTunnelSocket(subdomain: string): WebSocket | null {
        return this.tunnels.get(subdomain) ?? null;
    }

    async fetch(request: Request): Promise<Response> {
        // Handle WebSocket Upgrade (CLI connecting)
        if (request.headers.get("Upgrade") === "websocket") {
            return this.handleWebSocketUpgrade(request);
        }

        // Handle incoming HTTP request (Visitor)
        const url = new URL(request.url);
        const subdomain = url.hostname.split(".")[0];

        const ws = this.getTunnelSocket(subdomain);
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
        const [client, server] = Object.values(pair);

        // Close any existing connection for this subdomain
        const existing = this.tunnels.get(subdomain);
        if (existing) {
            existing.close(1000, "New connection replacing old one");
            this.tunnels.delete(subdomain);
        }

        this.ctx.acceptWebSocket(server);

        // Persist subdomain on the WebSocket so it survives hibernation
        server.serializeAttachment({ subdomain });
        this.tunnels.set(subdomain, server);

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
            // If no pending request found (e.g. after hibernation wake-up),
            // the response is silently dropped — the original HTTP caller
            // will have already timed out.
        } catch (e) {
            console.error("Failed to parse tunnel response:", e);
        }
    }

    async webSocketClose(ws: WebSocket, code: number, reason: string, _wasClean: boolean) {
        // Complete the close handshake; guard against double-close after hibernation wake-up
        try {
            ws.close(code, reason);
        } catch {
            // Already closed — safe to ignore
        }

        const attachment = ws.deserializeAttachment() as { subdomain: string } | null;
        if (attachment?.subdomain) {
            this.tunnels.delete(attachment.subdomain);
        }

        // Reject only pending requests that belong to this tunnel
        // (pendingRequests is empty after hibernation wake-up, so this is a no-op then)
        const sub = attachment?.subdomain;
        if (sub) {
            for (const [id, pending] of this.pendingRequests) {
                if (pending.subdomain === sub) {
                    pending.reject(new Error("Tunnel connection closed"));
                    this.pendingRequests.delete(id);
                }
            }
        }
    }

    async webSocketError(ws: WebSocket, error: unknown) {
        const attachment = ws.deserializeAttachment() as { subdomain: string } | null;
        const subdomain = attachment?.subdomain || "unknown";
        console.error(`Tunnel error for ${subdomain}:`, error);

        // Clean up the tunnel mapping on error
        if (attachment?.subdomain) {
            this.tunnels.delete(attachment.subdomain);

            // Reject pending requests for this tunnel
            for (const [id, pending] of this.pendingRequests) {
                if (pending.subdomain === attachment.subdomain) {
                    pending.reject(new Error("WebSocket error"));
                    this.pendingRequests.delete(id);
                }
            }
        }

        try {
            ws.close(1011, "WebSocket error");
        } catch {
            // Already closed
        }
    }

    private async proxyRequestToTunnel(request: Request, ws: WebSocket): Promise<Response> {
        const reqId = crypto.randomUUID();
        const url = new URL(request.url);
        const subdomain = url.hostname.split(".")[0];

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
                subdomain,
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
