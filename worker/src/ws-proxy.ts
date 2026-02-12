// WebSocket visitor proxy — handles visitor WS connections relayed through the tunnel.
// Isolated from the core HTTP tunnel logic in tunnel-do.ts.

export const TYPE_WS_OPEN = "ws-open";
export const TYPE_WS_FRAME = "ws-frame";
export const TYPE_WS_CLOSE = "ws-close";

export interface WSOpenMessage {
    type: typeof TYPE_WS_OPEN;
    id: string;
    path: string;
    headers: Record<string, string[]>;
}

export interface WSFrameMessage {
    type: typeof TYPE_WS_FRAME;
    id: string;
    isText: boolean;
    payload: string;
}

export interface WSCloseMessage {
    type: typeof TYPE_WS_CLOSE;
    id: string;
    code?: number;
    reason?: string;
}

export type WSMessage = WSOpenMessage | WSFrameMessage | WSCloseMessage;

/** Collect request headers into a multi-value map. */
export function collectHeaders(request: Request): Record<string, string[]> {
    const headers: Record<string, string[]> = {};
    for (const [key, value] of request.headers) {
        if (headers[key]) {
            headers[key].push(value);
        } else {
            headers[key] = [value];
        }
    }
    return headers;
}

/** Encode an ArrayBuffer as base64 (chunked to avoid stack overflow). */
export function encodeBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
}

/** Send a visitor's message as a ws-frame through the tunnel WebSocket. */
export function forwardVisitorFrame(
    sessionId: string,
    message: string | ArrayBuffer,
    tunnelWs: WebSocket
): void {
    const isText = typeof message === "string";
    const frame: WSFrameMessage = {
        type: TYPE_WS_FRAME,
        id: sessionId,
        isText,
        payload: isText ? (message as string) : encodeBase64(message as ArrayBuffer),
    };
    tunnelWs.send(JSON.stringify(frame));
}

/** Deliver a ws-frame from the tunnel to a visitor WebSocket. */
export function deliverFrameToVisitor(msg: WSFrameMessage, visitor: WebSocket): void {
    if (msg.isText) {
        visitor.send(msg.payload);
    } else {
        visitor.send(Uint8Array.from(atob(msg.payload), (c) => c.charCodeAt(0)));
    }
}
