package types

type TunnelRequest struct {
	ID      string              `json:"id"`
	Method  string              `json:"method"`
	Path    string              `json:"path"`
	Headers map[string][]string `json:"headers"`
	Body    string              `json:"body,omitempty"` // Base64 encoded
}

type TunnelResponse struct {
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
