import { DurableObject } from "cloudflare:workers";
import {
    TYPE_WS_OPEN, TYPE_WS_FRAME, TYPE_WS_CLOSE,
    type WSFrameMessage, type WSCloseMessage,
    collectHeaders, encodeBase64,
    forwardVisitorFrame, deliverFrameToVisitor,
} from "./ws-proxy";

// --- HTTP tunnel protocol types ---
const TYPE_HTTP_REQUEST = "http-request";
const TYPE_HTTP_RESPONSE = "http-response";

interface TunnelRequest {
    type: string;
    id: string;
    method: string;
    path: string;
    headers: Record<string, string[]>;
    body?: string;
}

interface TunnelResponse {
    type: string;
    id: string;
    status: number;
    headers: Record<string, string[]>;
    body?: string;
}

// --- WebSocket attachment types ---
interface TunnelAttachment { subdomain: string }
interface VisitorAttachment { visitorSessionId: string; subdomain: string }
type WSAttachment = TunnelAttachment | VisitorAttachment;


function isVisitor(a: WSAttachment): a is VisitorAttachment {
    return "visitorSessionId" in a;
}


export class TunnelDO extends DurableObject {
    // Reconstructed after Worker hibernation to restore active WebSocket tunnels
    private tunnels = new Map<string, WebSocket>();
    private visitorSockets = new Map<string, WebSocket>();

    private pendingRequests = new Map<
        string,
        { subdomain: string; resolve: (resp: TunnelResponse) => void; reject: (err: Error) => void }
    >();

    constructor(ctx: DurableObjectState, env: Env) {
        super(ctx, env);
        this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));

        // Restore WebSocket mappings after hibernation
        this.ctx.getWebSockets().forEach((ws) => {
            const att = ws.deserializeAttachment() as WSAttachment | null;
            if (!att) return;
            if (isVisitor(att)) {
                this.visitorSockets.set(att.visitorSessionId, ws);
            } else if (att.subdomain) {
                this.tunnels.set(att.subdomain, ws);
            }
        });
    }

    private getTunnelSocket(subdomain: string): WebSocket | null {
        return this.tunnels.get(subdomain) ?? null;
    }

    // ── Routing ──────────────────────────────────────────────

    async fetch(request: Request): Promise<Response> {
        const url = new URL(request.url);
        const isUpgrade = request.headers.get("Upgrade") === "websocket";

        // CLI tunnel connection
        if (url.pathname === "/_tunnel" && isUpgrade) {
            return this.handleTunnelUpgrade(request);
        }

        const subdomain = url.hostname.split(".")[0];
        const tunnelWs = this.getTunnelSocket(subdomain);
        if (!tunnelWs || tunnelWs.readyState !== WebSocket.OPEN) {
            return new Response("Tunnel not connected", { status: 502 });
        }

        // Visitor WebSocket upgrade
        if (isUpgrade) {
            return this.handleVisitorUpgrade(request, tunnelWs, subdomain);
        }

        // Regular HTTP request
        return this.proxyHTTPRequest(request, tunnelWs);
    }

    // ── CLI tunnel WebSocket upgrade ─────────────────────────

    private async handleTunnelUpgrade(request: Request): Promise<Response> {
        const url = new URL(request.url);
        const subdomain = url.searchParams.get("subdomain");
        if (!subdomain) {
            return new Response("Missing subdomain", { status: 400 });
        }

        const pair = new WebSocketPair();
        const [client, server] = Object.values(pair);

        const existing = this.tunnels.get(subdomain);
        if (existing) {
            existing.close(1000, "New connection replacing old one");
            this.tunnels.delete(subdomain);
        }

        this.ctx.acceptWebSocket(server);
        server.serializeAttachment({ subdomain } as TunnelAttachment);
        this.tunnels.set(subdomain, server);

        return new Response(null, { status: 101, webSocket: client });
    }

    // ── Visitor WebSocket upgrade (proxied through tunnel) ───

    private async handleVisitorUpgrade(
        request: Request, tunnelWs: WebSocket, subdomain: string
    ): Promise<Response> {
        const sessionId = crypto.randomUUID();
        const url = new URL(request.url);

        // Tell CLI to open a local WebSocket
        tunnelWs.send(JSON.stringify({
            type: TYPE_WS_OPEN,
            id: sessionId,
            path: url.pathname + url.search,
            headers: collectHeaders(request),
        }));

        const pair = new WebSocketPair();
        const [client, server] = Object.values(pair);

        this.ctx.acceptWebSocket(server);
        server.serializeAttachment({ visitorSessionId: sessionId, subdomain } as VisitorAttachment);
        this.visitorSockets.set(sessionId, server);

        return new Response(null, { status: 101, webSocket: client });
    }

    // ── Hibernation handlers ─────────────────────────────────

    async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
        const att = ws.deserializeAttachment() as WSAttachment | null;
        if (!att) return;

        // Visitor → forward frame to CLI tunnel
        if (isVisitor(att)) {
            const tunnelWs = this.getTunnelSocket(att.subdomain);
            if (tunnelWs && tunnelWs.readyState === WebSocket.OPEN) {
                forwardVisitorFrame(att.visitorSessionId, message, tunnelWs);
            }
            return;
        }

        // CLI tunnel → route by message type
        if (typeof message !== "string") return;
        try {
            const msg = JSON.parse(message);
            this.handleTunnelMessage(msg);
        } catch (e) {
            console.error("Failed to parse tunnel message:", e);
        }
    }

    private handleTunnelMessage(msg: any) {
        switch (msg.type) {
            case TYPE_HTTP_RESPONSE: {
                const pending = this.pendingRequests.get(msg.id);
                if (pending) {
                    pending.resolve(msg as TunnelResponse);
                    this.pendingRequests.delete(msg.id);
                }
                break;
            }
            case TYPE_WS_FRAME: {
                const visitor = this.visitorSockets.get(msg.id);
                if (visitor && visitor.readyState === WebSocket.OPEN) {
                    deliverFrameToVisitor(msg as WSFrameMessage, visitor);
                }
                break;
            }
            case TYPE_WS_CLOSE: {
                const visitor = this.visitorSockets.get(msg.id);
                if (visitor) {
                    const cm = msg as WSCloseMessage;
                    try { visitor.close(cm.code || 1000, cm.reason || ""); } catch { }
                    this.visitorSockets.delete(msg.id);
                }
                break;
            }
        }
    }

    async webSocketClose(ws: WebSocket, code: number, reason: string, _wasClean: boolean) {
        try { ws.close(code, reason); } catch { }

        const att = ws.deserializeAttachment() as WSAttachment | null;
        if (!att) return;

        // Visitor disconnected → notify CLI
        if (isVisitor(att)) {
            this.visitorSockets.delete(att.visitorSessionId);
            const tunnelWs = this.getTunnelSocket(att.subdomain);
            if (tunnelWs && tunnelWs.readyState === WebSocket.OPEN) {
                tunnelWs.send(JSON.stringify({
                    type: TYPE_WS_CLOSE, id: att.visitorSessionId, code, reason,
                }));
            }
            return;
        }

        // CLI tunnel disconnected → clean up everything for this subdomain
        const sub = att.subdomain;
        this.tunnels.delete(sub);

        for (const [id, pending] of this.pendingRequests) {
            if (pending.subdomain === sub) {
                pending.reject(new Error("Tunnel connection closed"));
                this.pendingRequests.delete(id);
            }
        }

        for (const [sessionId, visitor] of this.visitorSockets) {
            const va = visitor.deserializeAttachment() as VisitorAttachment | null;
            if (va && va.subdomain === sub) {
                try { visitor.close(1001, "Tunnel disconnected"); } catch { }
                this.visitorSockets.delete(sessionId);
            }
        }
    }

    async webSocketError(ws: WebSocket, error: unknown) {
        const att = ws.deserializeAttachment() as WSAttachment | null;
        if (!att) return;

        if (isVisitor(att)) {
            console.error(`Visitor WS error for session ${att.visitorSessionId}:`, error);
            this.visitorSockets.delete(att.visitorSessionId);
            try { ws.close(1011, "WebSocket error"); } catch { }
            return;
        }

        const sub = att.subdomain;
        console.error(`Tunnel error for ${sub}:`, error);
        this.tunnels.delete(sub);

        for (const [id, pending] of this.pendingRequests) {
            if (pending.subdomain === sub) {
                pending.reject(new Error("WebSocket error"));
                this.pendingRequests.delete(id);
            }
        }

        try { ws.close(1011, "WebSocket error"); } catch { }
    }

    // ── HTTP request proxy ───────────────────────────────────

    private async proxyHTTPRequest(request: Request, ws: WebSocket): Promise<Response> {
        const reqId = crypto.randomUUID();
        const url = new URL(request.url);
        const subdomain = url.hostname.split(".")[0];

        const tunnelReq: TunnelRequest = {
            type: TYPE_HTTP_REQUEST,
            id: reqId,
            method: request.method,
            path: url.pathname + url.search,
            headers: collectHeaders(request),
        };

        if (request.method !== "GET" && request.method !== "HEAD") {
            tunnelReq.body = encodeBase64(await request.arrayBuffer());
        }

        return new Promise<Response>((resolve) => {
            const timeout = setTimeout(() => {
                this.pendingRequests.delete(reqId);
                resolve(new Response("Gateway Timeout", { status: 504 }));
            }, 30000);

            this.pendingRequests.set(reqId, {
                subdomain,
                resolve: (resp) => {
                    clearTimeout(timeout);
                    const body = resp.body
                        ? Uint8Array.from(atob(resp.body), (c) => c.charCodeAt(0))
                        : null;

                    const respHeaders = new Headers();
                    if (resp.headers) {
                        for (const [key, values] of Object.entries(resp.headers)) {
                            for (const v of values) {
                                respHeaders.append(key, v);
                            }
                        }
                    }

                    resolve(new Response(body, { status: resp.status, headers: respHeaders }));
                },
                reject: (err) => {
                    clearTimeout(timeout);
                    resolve(new Response("Tunnel Error: " + err.message, { status: 502 }));
                },
            });

            try {
                ws.send(JSON.stringify(tunnelReq));
            } catch {
                this.pendingRequests.delete(reqId);
                clearTimeout(timeout);
                resolve(new Response("Tunnel disconnected during request", { status: 502 }));
            }
        });
    }
}
