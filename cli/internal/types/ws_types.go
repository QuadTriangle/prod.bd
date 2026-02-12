package types

// WSOpen tells the CLI to open a WebSocket to the local server.
type WSOpen struct {
	Type    string              `json:"type"`
	ID      string              `json:"id"` // Session ID
	Path    string              `json:"path"`
	Headers map[string][]string `json:"headers,omitempty"`
}

// WSFrame carries a single WebSocket frame through the tunnel.
type WSFrame struct {
	Type    string `json:"type"`
	ID      string `json:"id"`
	IsText  bool   `json:"isText"`
	Payload string `json:"payload"` // Raw string for text, base64 for binary
}

// WSClose signals the other side to close a proxied WebSocket session.
type WSClose struct {
	Type   string `json:"type"`
	ID     string `json:"id"`
	Code   int    `json:"code,omitempty"`
	Reason string `json:"reason,omitempty"`
}
