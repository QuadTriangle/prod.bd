package types

// Wire-level type discriminator — present on all tunnel messages
const (
	TypeHTTPRequest  = "http-request"
	TypeHTTPResponse = "http-response"
	TypeWSOpen       = "ws-open"
	TypeWSFrame      = "ws-frame"
	TypeWSClose      = "ws-close"
)

// TunnelRequest is an HTTP request forwarded through the tunnel.
type TunnelRequest struct {
	Type    string              `json:"type"`
	ID      string              `json:"id"`
	Method  string              `json:"method"`
	Path    string              `json:"path"`
	Headers map[string][]string `json:"headers"`
	Body    string              `json:"body,omitempty"` // Base64 encoded
}

// TunnelResponse is an HTTP response sent back through the tunnel.
type TunnelResponse struct {
	Type    string              `json:"type"`
	ID      string              `json:"id"`
	Status  int                 `json:"status"`
	Headers map[string][]string `json:"headers"`
	Body    string              `json:"body,omitempty"` // Base64 encoded
}

type RegisterRequest struct {
	ClientID string `json:"clientId"`
	Ports    []int  `json:"ports"`
}

type RegisterResponse struct {
	Tunnels map[int]string `json:"tunnels"`
	Error   string         `json:"error,omitempty"`
}
