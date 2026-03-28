// Binary WebSocket frame protocol.
//
// Wire format: [4 bytes: header length N, big-endian uint32][N bytes: JSON header][remaining: raw body]
//
// Used for HTTP request/response messages to avoid base64 encoding of bodies.

/** Encode a JSON header + raw body into a binary frame. */
export function binEncode(header: object, body?: ArrayBuffer | Uint8Array | null): ArrayBuffer {
    const json = new TextEncoder().encode(JSON.stringify(header));
    const bodyLen = body ? body.byteLength : 0;
    const buf = new ArrayBuffer(4 + json.byteLength + bodyLen);
    const view = new DataView(buf);
    view.setUint32(0, json.byteLength);
    new Uint8Array(buf, 4, json.byteLength).set(json);
    if (body && bodyLen > 0) {
        new Uint8Array(buf, 4 + json.byteLength).set(
            body instanceof Uint8Array ? body : new Uint8Array(body)
        );
    }
    return buf;
}

/** Decode a binary frame into parsed JSON header and raw body bytes. */
export function binDecode(frame: ArrayBuffer): { header: any; body: Uint8Array } {
    const view = new DataView(frame);
    const headerLen = view.getUint32(0);
    const headerBytes = new Uint8Array(frame, 4, headerLen);
    const header = JSON.parse(new TextDecoder().decode(headerBytes));
    const body = new Uint8Array(frame, 4 + headerLen);
    return { header, body };
}
