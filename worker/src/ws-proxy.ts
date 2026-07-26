// WebSocket visitor proxy - handles visitor WS connections relayed through the tunnel.
// Isolated from the core HTTP tunnel logic in tunnel-do.ts.

import { binEncode, binDecode } from "./binproto";

export const TYPE_WS_OPEN = "ws-open";
export const TYPE_WS_FRAME = "ws-frame";
export const TYPE_WS_CLOSE = "ws-close";

export interface WSOpenMessage {
    type: typeof TYPE_WS_OPEN;
    id: string;
    path: string;
    headers: Record<string, string[]>;
}

export interface WSFrameHeader {
    type: typeof TYPE_WS_FRAME;
    id: string;
    isText: boolean;
}

export interface WSCloseMessage {
    type: typeof TYPE_WS_CLOSE;
    id: string;
    code?: number;
    reason?: string;
}

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

/** Send a visitor's message as a binary ws-frame through the tunnel WebSocket. */
export function forwardVisitorFrame(
    sessionId: string,
    message: string | ArrayBuffer,
    tunnelWs: WebSocket
): void {
    const isText = typeof message === "string";
    const header: WSFrameHeader = { type: TYPE_WS_FRAME, id: sessionId, isText };
    const payload = isText ? new TextEncoder().encode(message as string) : new Uint8Array(message as ArrayBuffer);
    tunnelWs.send(binEncode(header, payload));
}

/** Deliver a ws-frame from the tunnel to a visitor WebSocket. */
export function deliverFrameToVisitor(header: WSFrameHeader, body: Uint8Array, visitor: WebSocket): void {
    if (header.isText) {
        visitor.send(new TextDecoder().decode(body));
    } else {
        // body is a view into the binproto frame buffer; body.buffer is the WHOLE frame
        // (len prefix + JSON header + body). .slice() copies out just the body bytes —
        // without it, binary WS frames arrive corrupted (e.g. VNC/RFB -> Code 1006).
        visitor.send(body.slice().buffer);
    }
}
