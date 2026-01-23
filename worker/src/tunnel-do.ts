import { DurableObject } from "cloudflare:workers";



interface TunnelRequest {
	id: string;
	method: string;
	path: string;
	headers: Record<string, string>;
	body?: string; // Base64 encoded body
}

interface TunnelResponse {
	id: string;
	status: number;
	headers: Record<string, string>;
	body?: string; // Base64 encoded body
}

export class TunnelDO extends DurableObject {
	private webSocket: WebSocket | null = null;
	private pendingRequests = new Map<string, { resolve: (resp: TunnelResponse) => void; reject: (err: Error) => void }>();

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
	}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);

		// Handle WebSocket Upgrade (CLI connecting)
		if (request.headers.get("Upgrade") === "websocket") {
			return this.handleWebSocketUpgrade(request);
		}

		// Handle incoming HTTP request (Visitor)
		if (this.webSocket && this.webSocket.readyState === WebSocket.OPEN) {
			return this.proxyRequestToTunnel(request);
		}

		return new Response("Tunnel not connected", { status: 502 });
	}

	private async handleWebSocketUpgrade(request: Request): Promise<Response> {
		const pair = new WebSocketPair();
		const [client, server] = [pair[0], pair[1]];

		this.ctx.acceptWebSocket(server);
		this.webSocket = server;

        // Setup initial tags or state if needed
		// server.serializeAttachment(...)

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
		console.log("Tunnel closed:", code, reason);
		this.webSocket = null;
        // Reject all pending requests
        for (const [id, { reject }] of this.pendingRequests) {
            reject(new Error("Tunnel disconnected"));
        }
        this.pendingRequests.clear();
	}

	async webSocketError(ws: WebSocket, error: unknown) {
		console.error("Tunnel error:", error);
        // We might not want to close immediately, but for now lets rely on close event
	}

	private async proxyRequestToTunnel(request: Request): Promise<Response> {
		const reqId = crypto.randomUUID();
        const url = new URL(request.url);

		const tunnelReq: TunnelRequest = {
			id: reqId,
			method: request.method,
			path: url.pathname + url.search,
			headers: Object.fromEntries(request.headers),
		};

        const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
		if (hasBody) {
			const arrayBuffer = await request.arrayBuffer();
			tunnelReq.body = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
		}

		return new Promise<Response>((resolve, reject) => {
             // Timeout after 10s
             const timeout = setTimeout(() => {
                 this.pendingRequests.delete(reqId);
                 resolve(new Response("Gateway Timeout", { status: 504 }));
             }, 10000);

			this.pendingRequests.set(reqId, {
				resolve: (tunnelResp) => {
                    clearTimeout(timeout);
					const body = tunnelResp.body
						? Uint8Array.from(atob(tunnelResp.body), (c) => c.charCodeAt(0))
						: null;
					resolve(new Response(body, {
						status: tunnelResp.status,
						headers: tunnelResp.headers,
					}));
				},
				reject: (err) => {
                    clearTimeout(timeout);
                    resolve(new Response("Tunnel Error: " + err.message, { status: 502 }));
                },
			});

            if (this.webSocket) {
			    this.webSocket.send(JSON.stringify(tunnelReq));
            } else {
                 this.pendingRequests.delete(reqId);
                 resolve(new Response("Tunnel disconnected during request", { status: 502 }));
            }
		});
	}
}
