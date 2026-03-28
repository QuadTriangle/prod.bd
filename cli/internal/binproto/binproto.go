// Package binproto implements a binary WebSocket frame protocol.
//
// Wire format for frames with a body:
//
//	[4 bytes: header length N, big-endian uint32][N bytes: JSON header][remaining: raw body]
//
// Messages without a body (ws-open, ws-close) are sent as plain JSON text frames.
package binproto

import (
	"encoding/binary"
	"encoding/json"
	"fmt"
)

// Encode packs a JSON-serializable header and optional raw body into a binary frame.
func Encode(header any, body []byte) ([]byte, error) {
	hdr, err := json.Marshal(header)
	if err != nil {
		return nil, fmt.Errorf("binproto: marshal header: %w", err)
	}
	buf := make([]byte, 4+len(hdr)+len(body))
	binary.BigEndian.PutUint32(buf, uint32(len(hdr)))
	copy(buf[4:], hdr)
	copy(buf[4+len(hdr):], body)
	return buf, nil
}

// Decode splits a binary frame into the raw JSON header and body bytes.
func Decode(frame []byte) (header json.RawMessage, body []byte, err error) {
	if len(frame) < 4 {
		return nil, nil, fmt.Errorf("binproto: frame too short (%d bytes)", len(frame))
	}
	n := binary.BigEndian.Uint32(frame[:4])
	if int(n) > len(frame)-4 {
		return nil, nil, fmt.Errorf("binproto: header length %d exceeds frame", n)
	}
	return frame[4 : 4+n], frame[4+n:], nil
}
